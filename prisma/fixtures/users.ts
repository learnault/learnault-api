import { Role } from '@prisma/client'

export type SeedUser = {
  id: string
  email: string
  username: string
  name: string
  role: Role
  status: string
  isVerified: boolean
  walletAddress: string | null
}

export const seedUserFixtures: SeedUser[] = [
  {
    id: 'seed-user-admin-ada',
    email: 'ada.admin+seed@learnault.local',
    username: 'ada_admin_seed',
    name: 'Ada Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    isVerified: true,
    walletAddress: 'GD6QK3H5MYYXQUDMVDGLDZ4E2IWXQ7N5SLW7PZBLW4D5YV3V2NFH8A1A',
  },
  {
    id: 'seed-user-instructor-deepak',
    email: 'deepak.instructor+seed@learnault.local',
    username: 'deepak_inst_seed',
    name: 'Deepak Instructor',
    role: 'INSTRUCTOR',
    status: 'ACTIVE',
    isVerified: true,
    walletAddress: 'GDVXG4D7WQ3WWT3S3Q6L2J5KLC2TSGBYHYQ4M4U7QWEK3J75VYLPQ9U2',
  },
  {
    id: 'seed-user-employer-acme',
    email: 'acme.employer+seed@learnault.local',
    username: 'acme_emp_seed',
    name: 'Acme Talent Team',
    role: 'LEARNER',
    status: 'ACTIVE',
    isVerified: true,
    walletAddress: null,
  },
  {
    id: 'seed-user-learner-alice',
    email: 'alice.learner+seed@learnault.local',
    username: 'alice_learner_seed',
    name: 'Alice Learner',
    role: 'LEARNER',
    status: 'ACTIVE',
    isVerified: true,
    walletAddress: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFSRJ4HBSNF63YLIXLQ5EDLF274Y6C',
  },
  {
    id: 'seed-user-learner-bob',
    email: 'bob.learner+seed@learnault.local',
    username: 'bob_learner_seed',
    name: 'Bob Learner',
    role: 'LEARNER',
    status: 'ACTIVE',
    isVerified: false,
    walletAddress: 'GB7YLLICSMNYWJ46NWYCBTGXD54FPPWFY3YQYBFJFTQ6B2N3WHAL5V4K',
  },
  {
    id: 'seed-user-learner-carla',
    email: 'carla.learner+seed@learnault.local',
    username: 'carla_learner_seed',
    name: 'Carla Learner',
    role: 'LEARNER',
    status: 'DEACTIVATED',
    isVerified: true,
    walletAddress: 'GA5N2IBQ2J5KVSBBR6K7D6JQ3Y7L46BP3I7WNIPXQ2XH2WQOTJXK5C2Z',
  },
]
