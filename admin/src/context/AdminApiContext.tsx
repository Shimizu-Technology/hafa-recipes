import { createContext, useContext, type ReactNode } from 'react'
import type { AdminApi } from '../types'

const AdminApiContext = createContext<AdminApi | null>(null)

export function AdminApiProvider({ api, children }: { api: AdminApi; children: ReactNode }) {
  return <AdminApiContext.Provider value={api}>{children}</AdminApiContext.Provider>
}

export function useAdminApi(): AdminApi {
  const api = useContext(AdminApiContext)
  if (!api) throw new Error('AdminApiProvider is missing')
  return api
}
