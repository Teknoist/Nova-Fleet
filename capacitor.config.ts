import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.novafleet.android',
  appName: 'Nova Fleet',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    captureInput: true,
  },
}

export default config
