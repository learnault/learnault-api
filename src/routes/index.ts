import { Router } from 'express'
import userRoutes from './v1/users.routes'
import rewardRoutes from './v1/rewards.routes'

const router = Router()

router.get('/', (req, res) => {
  res.json({ message: 'API is running' })
})

router.use('/v1/users', userRoutes)
router.use('/v1/rewards', rewardRoutes)

export default router
