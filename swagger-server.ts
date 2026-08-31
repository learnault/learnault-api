import express from 'express'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import cors from 'cors'

const app = express()
const PORT = 5000

app.use(cors())

// Use the same configuration as the main app
const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Learnault API Documentation',
      version: '1.0.0',
      description:
        'Comprehensive API documentation for Learnault - a decentralized learn-to-earn platform on Stellar',
      contact: {
        name: 'Learnault Contributors',
        url: 'https://github.com/learnault/learnault',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'Main API base path',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/controllers/**/*.ts', './src/docs/*.ts'],
}

const specs = swaggerJsdoc(options)

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))

app.get('/', (req, res) => {
  res.redirect('/api-docs')
})

app.listen(PORT, () => {
  console.log(`Swagger documentation server running on port ${PORT}`)
  console.log(`View at http://localhost:${PORT}/api-docs`)
})
