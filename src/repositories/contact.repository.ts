import { Contact, LinkPrecedence, Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

export class ContactRepository {
  async findMatchingContacts(
    tx: TransactionClient,
    email?: string | null,
    phoneNumber?: string | null,
  ): Promise<Contact[]> {
    const conditions: Prisma.ContactWhereInput[] = [];

    if (email) {
      conditions.push({ email });
    }
    if (phoneNumber) {
      conditions.push({ phoneNumber });
    }

    if (conditions.length === 0) {
      return [];
    }

    return tx.contact.findMany({
      where: {
        OR: conditions,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findContactsByPrimaryId(tx: TransactionClient, primaryId: number): Promise<Contact[]> {
    return tx.contact.findMany({
      where: {
        linkedId: primaryId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findContactById(tx: TransactionClient, id: number): Promise<Contact | null> {
    return tx.contact.findUnique({
      where: { id },
    });
  }

  async createContact(
    tx: TransactionClient,
    data: {
      email?: string | null;
      phoneNumber?: string | null;
      linkedId?: number | null;
      linkPrecedence: LinkPrecedence;
    },
  ): Promise<Contact> {
    return tx.contact.create({
      data: {
        email: data.email ?? null,
        phoneNumber: data.phoneNumber ?? null,
        linkedId: data.linkedId ?? null,
        linkPrecedence: data.linkPrecedence,
      },
    });
  }

  async updateContact(
    tx: TransactionClient,
    id: number,
    data: Partial<Pick<Contact, 'linkedId' | 'linkPrecedence'>>,
  ): Promise<Contact> {
    return tx.contact.update({
      where: { id },
      data,
    });
  }
}

export const contactRepository = new ContactRepository();
