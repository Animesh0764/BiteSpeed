import { Request, Response, NextFunction } from 'express';
import { contactService } from '../services/contact.service';
import { IdentifyRequest } from '../types';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export class ContactController {
  async identify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as IdentifyRequest;
      let { email, phoneNumber } = body;

      if (!email && !phoneNumber) {
        throw new AppError('At least one of email or phoneNumber must be provided', 400);
      }

      if (email) {
        email = email.trim().toLowerCase();
      }

      if (phoneNumber) {
        phoneNumber = String(phoneNumber).trim();
      }

      logger.info('Processing identify request', {
        email: email || null,
        phoneNumber: phoneNumber || null,
      });

      const result = await contactService.identify(email || null, phoneNumber || null);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const contactController = new ContactController();
