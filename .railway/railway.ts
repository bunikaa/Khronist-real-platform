import { defineRailway, github, postgres, preserve, project, service } from 'railway/iac'

const region = 'europe-west4-drams3a'

export default defineRailway(() => {
  const db = postgres('postgres', { region })

  const api = service('api', {
    source: github('code-by-accident/Khronist-real-platform', {
      branch: 'main',
      checkSuites: true,
    }),
    build: {
      builder: 'RAILPACK',
      watchPatterns: [
        '/apps/api/**',
        '/packages/contracts/**',
        '/packages/prompts/**',
        '/package.json',
        '/pnpm-lock.yaml',
        '/pnpm-workspace.yaml',
      ],
    },
    preDeploy: 'pnpm db:migrate',
    start: 'pnpm --filter @khronist/api start',
    healthcheck: '/health',
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: 'production',
      RAILPACK_NODE_VERSION: '24',
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '25',
      RAILWAY_DEPLOYMENT_OVERLAP_SECONDS: '0',
      DATABASE_URL: db.env.DATABASE_URL,
      CLIENT_IP_HEADER: 'x-real-ip',
      HTR_MODEL_PRIMARY: 'claude-sonnet-5-5',
      HTR_MODEL_FALLBACK: 'gemini-3.6-flash',
      ANTHROPIC_API_KEY: preserve(),
      GOOGLE_API_KEY: preserve(),
    },
  })

  return project('khronist', { resources: [api, db] })
})
