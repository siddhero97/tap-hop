import { Router } from 'express';
import { validateMiddleware } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { RegisterSchema, LoginSchema } from './auth.validator.js';
import { register, login, logout, me } from './auth.controller.js';

const router: Router = Router();

router.post('/register', validateMiddleware(RegisterSchema, 'body'), register);
router.post('/login', validateMiddleware(LoginSchema, 'body'), login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);

export { router as authRouter };
