import { Request, Response } from 'express';

export class ModuleController {
  async getAllModules(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async getModuleById(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async createModule(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async updateModule(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async deleteModule(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async enrollInModule(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }

  async updateProgress(req: Request, res: Response): Promise<void> {
    res.status(501).json({ message: 'Not implemented' });
  }
}
