import { Request, Response } from 'express';

export class RewardController {
  async getBalance(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async getTransactions(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }
}
