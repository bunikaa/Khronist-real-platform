import { defineRailway, github, postgres, preserve, project, service } from 'railway/iac'

const region = 'europe-west4-drams3a'
const port = 8080

export default defineRailway(() => {
  const db = postgres('postgres', { region })

  const api = service('api', {
    source: github('code-by-accident/Khronist-real-platform', {
      branch: 'main',
      checkSuites: true,
    }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter @khronist/api run --if-present build',
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
    domains: [{ domain: 'api.khronist.org', port }],
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      RAILPACK_NODE_VERSION: '24',
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '150',
      RAILWAY_DEPLOYMENT_OVERLAP_SECONDS: '0',
      DATABASE_URL: db.env.DATABASE_URL,
      CLIENT_IP_HEADER: 'x-real-ip',
      GUEST_RECOGNITIONS_PER_DAY: '300',
      API_KEY_RECOGNITIONS_PER_DAY: '1000',
      MODEL_CALLS_PER_DAY: '2000',
      HTR_MODEL_PRIMARY: 'claude-sonnet-5-5',
      HTR_MODEL_FALLBACK: 'gemini-3.6-flash',
      BETTER_AUTH_URL: 'https://api.khronist.org',
      MAIL_FROM: 'Хроніст <hello@khronist.org>',
      SIGN_IN_CODES_PER_DAY: '300',
      ANTHROPIC_API_KEY: preserve(),
      GOOGLE_API_KEY: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      ADMIN_API_KEY: preserve(),
    },
  })

  return project('khronist', { resources: [api, db] })
})
