import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.materio.app',
  appName: 'Materio',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'getmaterio.app',
      '*.getmaterio.app',
      'sereine.vercel.app',
      'openrouter.ai'
    ]
  }
};

export default config;
