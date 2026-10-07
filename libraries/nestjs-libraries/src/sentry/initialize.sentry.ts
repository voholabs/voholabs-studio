import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';
import {
  redactBreadcrumb,
  redactEvent,
  redactLog,
} from '@gitroom/nestjs-libraries/sentry/sentry.scrub';

export const initializeSentry = (appName: string, allowLogs = false) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `Voholabs ${capitalize(appName)}`,
          },
        },
      },
      environment: process.env.NODE_ENV || 'development',
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
        // Only warnings and errors become Sentry logs; console.log/info stay
        // in the container logs.
        Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
        // Spans and token usage only - prompts and completions stay out.
        Sentry.openAIIntegration({
          recordInputs: false,
          recordOutputs: false,
        }),
      ],
      sendDefaultPii: false,
      tracesSampleRate: 0.2,
      enableLogs: true,
      // API keys ride in MCP/SSE URL paths and some query strings; auth
      // headers, cookies and credential-bearing bodies never leave the box.
      beforeSend: (event) => redactEvent(event),
      beforeSendTransaction: (event) => redactEvent(event),
      beforeBreadcrumb: (breadcrumb) => redactBreadcrumb(breadcrumb),
      beforeSendLog: (log) => redactLog(log),

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.45,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
