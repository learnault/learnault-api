import { Request, Response } from 'express';

export class CredentialController {
  async getUserCredentials(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async getCredentialById(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async verifyCredential(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async revokeCredential(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }
}
