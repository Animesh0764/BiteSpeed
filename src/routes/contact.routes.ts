import { Router } from 'express';
import { contactController } from '../controllers/contact.controller';

const router = Router();

router.post('/identify', (req, res, next) => contactController.identify(req, res, next));

export default router;
