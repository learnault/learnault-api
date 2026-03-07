import { Request, Response } from 'express';

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async login(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async forgotPassword(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }
}
