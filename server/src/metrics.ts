import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'

/** Prometheus metrics, served on METRICS_PORT (not through the public ingress). */
export function createMetrics(defaultMetrics = true) {
  const registry = new Registry()
  if (defaultMetrics) collectDefaultMetrics({ register: registry, prefix: 'africair_api_' })

  return {
    registry,
    httpRequests: new Counter({ name: 'africair_http_requests_total', help: 'HTTP requests handled', labelNames: ['method', 'route', 'status'], registers: [registry] }),
    httpDuration: new Histogram({
      name: 'africair_http_request_duration_seconds', help: 'HTTP request latency', labelNames: ['method', 'route'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5], registers: [registry],
    }),
    bookingsCreated: new Counter({ name: 'africair_bookings_created_total', help: 'Bookings stored in the database', labelNames: ['cabin', 'trip_type'], registers: [registry] }),
    bookingsCancelled: new Counter({ name: 'africair_bookings_cancelled_total', help: 'Bookings cancelled', registers: [registry] }),
    bookingValueUsd: new Counter({ name: 'africair_booking_value_usd_total', help: 'Total value of bookings created, in USD', registers: [registry] }),
    promoValidations: new Counter({ name: 'africair_promo_validations_total', help: 'Promo code checks', labelNames: ['result'], registers: [registry] }),
    adminLogins: new Counter({ name: 'africair_admin_requests_total', help: 'Admin API requests', labelNames: ['result'], registers: [registry] }),
    dbUp: new Gauge({ name: 'africair_db_up', help: '1 if the last database check succeeded, 0 if it failed, -1 if no database is configured', registers: [registry] }),
    maintenance: new Gauge({ name: 'africair_maintenance_mode', help: '1 while MAINTENANCE_MODE is on', registers: [registry] }),
    info: new Gauge({ name: 'africair_build_info', help: 'Build and environment information', labelNames: ['version', 'commit', 'app_env'], registers: [registry] }),
  }
}

export type Metrics = ReturnType<typeof createMetrics>
