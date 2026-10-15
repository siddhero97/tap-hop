import { Router } from 'express';
import { getHealth } from '../controllers/health.js';

const router = Router();

/**
 * GET /health - Health check endpoint
 */
router.get('/', getHealth);

export { router as healthRouter };
