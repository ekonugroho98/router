// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 1;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },

  // ADDON: saas-mt — multi-tenant customer accounts (signup/login)
  // Each customer has a separate account with their own API keys + usage quota.
  // Customer-facing /customer/* routes use this for auth.
  customers: {
    columns: {
      id: "TEXT PRIMARY KEY",
      email: "TEXT UNIQUE NOT NULL",
      passwordHash: "TEXT NOT NULL",            // bcrypt hash
      displayName: "TEXT",
      plan: "TEXT DEFAULT 'free'",              // 'free', 'pro', 'enterprise'
      quotaDailyLimit: "INTEGER DEFAULT 1000",  // req/day cap (0 = unlimited)
      quotaMonthlyLimit: "INTEGER DEFAULT 30000", // req/month cap (0 = unlimited)
      isActive: "INTEGER DEFAULT 1",            // 0 = suspended
      suspendedReason: "TEXT",
      metadata: "TEXT",                          // JSON: {phone, country, custom...}
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
      lastLoginAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cust_active ON customers(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_cust_plan ON customers(plan)",
    ],
  },

  // ADDON: saas-mt — API keys owned by customers (1:N relation)
  // Customer can have multiple keys (e.g. dev/prod, multiple bots, etc.).
  // Admin API keys remain in `apiKeys` table — these are SEPARATE.
  customerApiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      customerId: "TEXT NOT NULL",              // FK → customers.id
      key: "TEXT UNIQUE NOT NULL",              // sk-cortex-xxxxx format
      name: "TEXT",                              // user-friendly label (e.g. "prod-bot")
      isActive: "INTEGER DEFAULT 1",
      lastUsedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cak_customer ON customerApiKeys(customerId)",
      "CREATE INDEX IF NOT EXISTS idx_cak_active ON customerApiKeys(isActive)",
    ],
  },

  // ADDON: saas-mt — per-customer usage log + aggregation helpers
  // Separate from `usageHistory` (admin/system) for clean tenant isolation.
  // dateKey/monthKey enable fast "usage today / this month" queries via index.
  customerUsage: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      customerId: "TEXT NOT NULL",
      apiKeyId: "TEXT",                          // which customer key was used (nullable for system events)
      timestamp: "TEXT NOT NULL",                // ISO 8601 datetime
      dateKey: "TEXT NOT NULL",                  // YYYY-MM-DD for fast daily group-by
      monthKey: "TEXT NOT NULL",                 // YYYY-MM for monthly aggregates
      provider: "TEXT",                           // which upstream provider was routed to
      model: "TEXT",
      connectionId: "TEXT",                       // which provider connection (admin-side)
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",                    // USD or local currency unit
      status: "TEXT",                             // 'success', 'error', 'quota_exceeded', 'auth_fail'
      errorMessage: "TEXT",                       // truncated error msg if status != success
      latencyMs: "INTEGER",                       // request latency for SLA monitoring
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cu_customer_ts ON customerUsage(customerId, timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_cu_customer_date ON customerUsage(customerId, dateKey)",
      "CREATE INDEX IF NOT EXISTS idx_cu_customer_month ON customerUsage(customerId, monthKey)",
      "CREATE INDEX IF NOT EXISTS idx_cu_status ON customerUsage(status)",
    ],
  },

  // ADDON: saas-mt — server-side sessions for customer login
  // Cookie-based session (not JWT) — easier to invalidate on logout/admin-suspend.
  // Token = random opaque string, stored as bcrypt hash for defense-in-depth.
  customerSessions: {
    columns: {
      id: "TEXT PRIMARY KEY",                    // random session ID (set in cookie)
      customerId: "TEXT NOT NULL",               // FK → customers.id
      tokenHash: "TEXT NOT NULL",                // bcrypt hash of full token (extra safety)
      userAgent: "TEXT",
      ipAddress: "TEXT",
      createdAt: "TEXT NOT NULL",
      expiresAt: "TEXT NOT NULL",                // ISO 8601 — server-enforced
      lastSeenAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cs_customer ON customerSessions(customerId)",
      "CREATE INDEX IF NOT EXISTS idx_cs_expires ON customerSessions(expiresAt)",
    ],
  },

  // ADDON: saas-mt — redemption codes for customer activation
  redeemCodes: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      code: "TEXT NOT NULL UNIQUE",              // e.g. CORTEX-XXXX-XXXX
      plan: "TEXT NOT NULL DEFAULT 'free'",      // 'free' | 'starter' | 'pro' | 'enterprise'
      durationDays: "INTEGER NOT NULL DEFAULT 3", // how many days active after redeem
      quotaDailyLimit: "INTEGER NOT NULL DEFAULT 100",
      quotaMonthlyLimit: "INTEGER NOT NULL DEFAULT 3000",
      maxUses: "INTEGER NOT NULL DEFAULT 1",     // how many times this code can be used
      usedCount: "INTEGER NOT NULL DEFAULT 0",
      isActive: "INTEGER NOT NULL DEFAULT 1",    // admin can deactivate
      label: "TEXT",                             // admin note: "lynk.id free batch 1"
      createdAt: "TEXT NOT NULL DEFAULT (datetime('now'))",
      expiresAt: "TEXT",                         // code itself expires (optional)
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_rc_code ON redeemCodes(code)",
    ],
  },

  // ADDON: saas-mt — one-time claim tokens (Lynk.id integration)
  claimTokens: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      token: "TEXT NOT NULL UNIQUE",               // random URL-safe string
      plan: "TEXT NOT NULL DEFAULT 'free'",
      durationDays: "INTEGER NOT NULL DEFAULT 3",
      quotaDailyLimit: "INTEGER NOT NULL DEFAULT 300",
      quotaMonthlyLimit: "INTEGER NOT NULL DEFAULT 9000",
      maxClaims: "INTEGER NOT NULL DEFAULT 1",
      claimedCount: "INTEGER NOT NULL DEFAULT 0",
      isActive: "INTEGER NOT NULL DEFAULT 1",
      label: "TEXT",
      createdAt: "TEXT NOT NULL DEFAULT (datetime('now'))",
      expiresAt: "TEXT",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_token ON claimTokens(token)",
    ],
  },

  // ADDON: saas-mt — audit trail for admin actions on customers
  customerAuditLog: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL DEFAULT (datetime('now'))",
      action: "TEXT NOT NULL",                   // 'create' | 'update' | 'delete' | 'reset_password' | 'suspend' | 'unsuspend'
      customerId: "TEXT",                        // FK → customers.id (nullable for deleted customers)
      customerEmail: "TEXT",                     // denormalized — preserved after delete
      changes: "TEXT",                           // JSON of field changes { field: { from, to } }
      adminIp: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cal_customer ON customerAuditLog(customerId)",
      "CREATE INDEX IF NOT EXISTS idx_cal_ts ON customerAuditLog(timestamp DESC)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
