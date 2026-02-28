import { Contact, LinkPrecedence } from '@prisma/client';
import prisma from '../utils/prisma';
import { contactRepository } from '../repositories/contact.repository';
import { IdentifyResponse } from '../types';
import { logger } from '../utils/logger';

export class ContactService {
  async identify(email?: string | null, phoneNumber?: string | null): Promise<IdentifyResponse> {
    return prisma.$transaction(async (tx) => {
      const matchingContacts = await contactRepository.findMatchingContacts(
        tx,
        email,
        phoneNumber,
      );

      if (matchingContacts.length === 0) {
        return this.handleNoMatch(tx, email, phoneNumber);
      }

      return this.handleMatch(tx, matchingContacts, email, phoneNumber);
    });
  }

  private async handleNoMatch(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    email?: string | null,
    phoneNumber?: string | null,
  ): Promise<IdentifyResponse> {
    logger.info('No existing contact found, creating new primary contact');

    const newContact = await contactRepository.createContact(tx, {
      email,
      phoneNumber,
      linkPrecedence: LinkPrecedence.primary,
    });

    return this.buildResponse(newContact, []);
  }

  private async handleMatch(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    matchingContacts: Contact[],
    email?: string | null,
    phoneNumber?: string | null,
  ): Promise<IdentifyResponse> {
    const allContacts = await this.collectFullCluster(tx, matchingContacts);
    const primary = await this.resolvePrimary(tx, allContacts);
    const updatedCluster = await this.refreshCluster(tx, primary);

    await this.createSecondaryIfNeeded(tx, updatedCluster, primary, email, phoneNumber);

    const finalCluster = await this.refreshCluster(tx, primary);
    return this.buildResponse(primary, finalCluster);
  }

  private async collectFullCluster(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    matchingContacts: Contact[],
  ): Promise<Contact[]> {
    const contactMap = new Map<number, Contact>();

    for (const contact of matchingContacts) {
      contactMap.set(contact.id, contact);
    }

    const primaryIds = new Set<number>();
    for (const contact of matchingContacts) {
      if (contact.linkPrecedence === LinkPrecedence.primary) {
        primaryIds.add(contact.id);
      } else if (contact.linkedId) {
        primaryIds.add(contact.linkedId);
      }
    }

    for (const primaryId of primaryIds) {
      if (!contactMap.has(primaryId)) {
        const primary = await contactRepository.findContactById(tx, primaryId);
        if (primary && !primary.deletedAt) {
          contactMap.set(primary.id, primary);
        }
      }

      const secondaries = await contactRepository.findContactsByPrimaryId(tx, primaryId);
      for (const secondary of secondaries) {
        contactMap.set(secondary.id, secondary);
      }
    }

    return Array.from(contactMap.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  private async resolvePrimary(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    contacts: Contact[],
  ): Promise<Contact> {
    const primaries = contacts.filter((c) => c.linkPrecedence === LinkPrecedence.primary);

    if (primaries.length <= 1) {
      return primaries[0];
    }

    primaries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const oldestPrimary = primaries[0];

    logger.info('Merging multiple primaries, oldest primary selected', {
      primaryId: oldestPrimary.id,
      merging: primaries.slice(1).map((p) => p.id),
    });

    for (let i = 1; i < primaries.length; i++) {
      const newerPrimary = primaries[i];

      await contactRepository.updateContact(tx, newerPrimary.id, {
        linkedId: oldestPrimary.id,
        linkPrecedence: LinkPrecedence.secondary,
      });

      const newerSecondaries = await contactRepository.findContactsByPrimaryId(
        tx,
        newerPrimary.id,
      );
      for (const secondary of newerSecondaries) {
        await contactRepository.updateContact(tx, secondary.id, {
          linkedId: oldestPrimary.id,
        });
      }
    }

    return oldestPrimary;
  }

  private async refreshCluster(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    primary: Contact,
  ): Promise<Contact[]> {
    return contactRepository.findContactsByPrimaryId(tx, primary.id);
  }

  private async createSecondaryIfNeeded(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    cluster: Contact[],
    primary: Contact,
    email?: string | null,
    phoneNumber?: string | null,
  ): Promise<void> {
    const allContacts = [primary, ...cluster];

    const comboExists = allContacts.some((c) => {
      const emailMatch = !email || c.email === email;
      const phoneMatch = !phoneNumber || c.phoneNumber === phoneNumber;
      return emailMatch && phoneMatch;
    });

    if (comboExists) {
      logger.info('Incoming combination already exists, skipping secondary creation');
      return;
    }

    const hasNewInfo =
      (email && !allContacts.some((c) => c.email === email)) ||
      (phoneNumber && !allContacts.some((c) => c.phoneNumber === phoneNumber));

    if (hasNewInfo || (!comboExists && (email || phoneNumber))) {
      logger.info('Creating new secondary contact', {
        primaryId: primary.id,
        email,
        phoneNumber,
      });

      await contactRepository.createContact(tx, {
        email,
        phoneNumber,
        linkedId: primary.id,
        linkPrecedence: LinkPrecedence.secondary,
      });
    }
  }

  private buildResponse(primary: Contact, secondaries: Contact[]): IdentifyResponse {
    const emails: string[] = [];
    const phoneNumbers: string[] = [];
    const secondaryContactIds: number[] = [];

    if (primary.email) {
      emails.push(primary.email);
    }
    if (primary.phoneNumber) {
      phoneNumbers.push(primary.phoneNumber);
    }

    for (const secondary of secondaries) {
      secondaryContactIds.push(secondary.id);

      if (secondary.email && !emails.includes(secondary.email)) {
        emails.push(secondary.email);
      }
      if (secondary.phoneNumber && !phoneNumbers.includes(secondary.phoneNumber)) {
        phoneNumbers.push(secondary.phoneNumber);
      }
    }

    return {
      contact: {
        primaryContactId: primary.id,
        emails,
        phoneNumbers,
        secondaryContactIds,
      },
    };
  }
}

export const contactService = new ContactService();
