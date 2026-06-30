/// <reference types="vite/client" />

import type { NovaFleetApi } from './shared/types'

declare global {
  interface Window { novaFleet: NovaFleetApi }
}

export {}
