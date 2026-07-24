import request from 'supertest'
import app from '../../../../src/app'

export interface ApiResponse<T = any> {
  status: number
  body: T
  headers: Record<string, string>
}

/**
 * Type-safe API client for integration tests.
 */
export class ApiClient {
  private token?: string
  private baseUrl = '/api/v1'

  constructor(token?: string) {
    this.token = token
  }

  /**
   * Set the authentication token for subsequent requests.
   */
  setToken(token: string): void {
    this.token = token
  }

  /**
   * Clear the authentication token.
   */
  clearToken(): void {
    this.token = undefined
  }

  /**
   * Perform a GET request.
   */
  async get<T = any>(path: string, query?: Record<string, any>): Promise<ApiResponse<T>> {
    let req = request(app).get(`${this.baseUrl}${path}`)
    
    if (this.token) {
      req = req.set('Authorization', `Bearer ${this.token}`)
    }
    
    if (query) {
      req = req.query(query)
    }
    
    const response = await req
    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
    }
  }

  /**
   * Perform a POST request.
   */
  async post<T = any>(path: string, body?: any): Promise<ApiResponse<T>> {
    let req = request(app).post(`${this.baseUrl}${path}`)
    
    if (this.token) {
      req = req.set('Authorization', `Bearer ${this.token}`)
    }
    
    if (body) {
      req = req.send(body)
    }
    
    const response = await req

    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
    }
  }

  /**
   * Perform a PATCH request.
   */
  async patch<T = any>(path: string, body?: any): Promise<ApiResponse<T>> {
    let req = request(app).patch(`${this.baseUrl}${path}`)
    
    if (this.token) {
      req = req.set('Authorization', `Bearer ${this.token}`)
    }
    
    if (body) {
      req = req.send(body)
    }
    
    const response = await req

    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
    }
  }

  /**
   * Perform a DELETE request.
   */
  async delete<T = any>(path: string): Promise<ApiResponse<T>> {
    let req = request(app).delete(`${this.baseUrl}${path}`)
    
    if (this.token) {
      req = req.set('Authorization', `Bearer ${this.token}`)
    }
    
    const response = await req

    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
    }
  }

  /**
   * Perform a PUT request.
   */
  async put<T = any>(path: string, body?: any): Promise<ApiResponse<T>> {
    let req = request(app).put(`${this.baseUrl}${path}`)
    
    if (this.token) {
      req = req.set('Authorization', `Bearer ${this.token}`)
    }
    
    if (body) {
      req = req.send(body)
    }
    
    const response = await req

    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
    }
  }
}

/**
 * Create an unauthenticated API client.
 */
export function createClient(): ApiClient {
  return new ApiClient()
}

/**
 * Create an authenticated API client with the given token.
 */
export function createAuthenticatedClient(token: string): ApiClient {
  return new ApiClient(token)
}
