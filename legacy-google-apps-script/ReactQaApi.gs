/**
 * QA CONTROL CENTER - REACT WRITE API
 *
 * Add this as a NEW .gs file inside the SAME Apps Script project that already
 * contains your QA Tracker Code.gs and deployed Web App URL.
 *
 * It adds doPost(e) for the React app. It does not replace doGet(e), does not
 * rename tabs, does not clear Agents Reviewed, and does not move saved rows.
 */

const QA_APP_CONFIG = {
  SPREADSHEET_ID: "1GpR3siePgY45jGJfsAB2Q1obCW34A-tfKJOrI8ruEwg",
  REVIEW_SHEET_NAME: "Agents Reviewed",
  USERS_SHEET_NAME: "QA App Users",
  SETTINGS_SHEET_NAME: "QA App Settings",
  AUDIT_SHEET_NAME: "QA App Audit",
  PRESENCE_SHEET_NAME: "QA App Presence",
  PRESENCE_ONLINE_SECONDS: 65,
  PROXY_SECRET_PROPERTY: "QA_APP_PROXY_SECRET",
  CACHE_KEY: "agent-picks-agents-reviewed-v8-fast-runtime",
  ADMIN_EMAILS: [
    "infojr.83@gmail.com",
    "barbara.kalchik8reserve@gmail.com"
  ]
};

const QA_APP_USER_HEADERS = [
  "Email",
  "Display Name",
  "Role",
  "Active",
  "Guided Mode",
  "Can Submit Reviews",
  "Can View History",
  "Can Edit Agent Details",
  "Can Edit Criteria Selections",
  "Can Edit Custom Notes",
  "Notes",
  "Created At",
  "Updated At",
  "Updated By"
];

const QA_APP_AUDIT_HEADERS = [
  "Timestamp",
  "Action",
  "Actor Email",
  "Target Email",
  "Details JSON"
];

const QA_APP_PRESENCE_HEADERS = [
  "Email",
  "Display Name",
  "Role",
  "Current Page",
  "Last Seen",
  "Session ID"
];

const QA_APP_SETTINGS_HEADERS = [
  "Key",
  "JSON Value",
  "Updated At",
  "Updated By"
];

function qaAppSetup() {
  const ss = SpreadsheetApp.openById(QA_APP_CONFIG.SPREADSHEET_ID);
  qaAppEnsureUsersSheet_(ss);
  qaAppEnsureSettingsSheet_(ss);
  qaAppEnsureAuditSheet_(ss);
  qaAppEnsurePresenceSheet_(ss);
  qaAppEnsureReviewHeaders_(ss);
  qaAppSeedCoreUsers_(ss);
  qaAppSeedDefaultSettings_(ss);

  const properties = PropertiesService.getScriptProperties();
  let secret = String(properties.getProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY) || "").trim();

  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    properties.setProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY, secret);
  }

  SpreadsheetApp.getUi().alert(
    "QA React API Setup Complete",
    "The React API sheets and core users are ready. No Agents Reviewed data was deleted or moved.\n\nCopy this secret into the Netlify environment variable QA_APP_PROXY_SECRET:\n\n" + secret,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function qaAppShowProxySecret() {
  const secret = String(
    PropertiesService.getScriptProperties().getProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY) || ""
  ).trim();

  SpreadsheetApp.getUi().alert(
    secret
      ? "Current QA_APP_PROXY_SECRET:\n\n" + secret
      : "No proxy secret exists yet. Run qaAppSetup first."
  );
}

function doPost(e) {
  try {
    const request = qaAppParseRequest_(e);
    qaAppVerifyProxySecret_(request.proxySecret);

    const actorEmail = qaAppNormalizeEmail_(request.actorEmail);
    const actorName = qaAppCleanText_(request.actorName);
    const action = qaAppCleanText_(request.action).toLowerCase();

    if (!actorEmail) {
      throw new Error("A verified Google account email is required.");
    }

    const ss = SpreadsheetApp.openById(QA_APP_CONFIG.SPREADSHEET_ID);

    /*
     * IMPORTANT:
     * Runtime API requests must not run setup, formatting, seeding, or header
     * repair. Those operations are intentionally limited to qaAppSetup().
     * Running them during every login and heartbeat was causing 20-30 second
     * requests and Netlify timeouts.
     */
    const actor = qaAppGetUserByEmailFast_(ss, actorEmail);

    if (!actor) {
      throw new Error(
        'This Google account has not been added to the QA app. Run qaAppSetup once if the API sheets are missing.'
      );
    }

    if (!actor.active) {
      throw new Error("This QA app account is blocked. Contact Junior or Barbara.");
    }

    if (action === "authorize") {
      return qaAppJson_({
        success: true,
        user: actor
      });
    }

    if (action === "bootstrap") {
      const settings = qaAppReadSettingsFast_(ss);
      const users = actor.role === "admin"
        ? qaAppReadUsersFast_(ss)
        : [actor];

      return qaAppJson_({
        success: true,
        user: actor,
        users: users,
        settings: settings
      });
    }

    if (action === "updatepresence") {
      const presence = qaAppUpdatePresence_(
        ss,
        actor,
        request.currentPage,
        request.sessionId
      );

      return qaAppJson_({
        success: true,
        presence: presence
      });
    }

    if (action === "getpresence") {
      return qaAppJson_({
        success: true,
        users: qaAppGetPresence_(ss)
      });
    }

    if (action === "removepresence") {
      qaAppRemovePresence_(ss, actorEmail, request.sessionId);
      return qaAppJson_({ success: true });
    }

    if (action === "savereview") {
      const result = qaAppSaveReview_(ss, actor, request.review || {}, actorName);
      return qaAppJson_(result);
    }

    if (action === "upsertuser") {
      qaAppAssertAdmin_(actor);

      const savedUser = qaAppUpsertUser_(
        ss,
        request.user || {},
        actorEmail
      );

      qaAppClearRuntimeCaches_();

      qaAppAudit_(
        ss,
        "USER UPSERTED",
        actorEmail,
        savedUser.email,
        savedUser
      );

      return qaAppJson_({
        success: true,
        message: savedUser.displayName + " was saved.",
        user: savedUser
      });
    }

    if (action === "setuserblocked") {
      qaAppAssertAdmin_(actor);

      const targetEmail = qaAppNormalizeEmail_(request.email);
      const blocked = qaAppBoolean_(request.blocked);

      const updated = qaAppSetUserBlocked_(
        ss,
        targetEmail,
        blocked,
        actorEmail
      );

      qaAppClearRuntimeCaches_();

      qaAppAudit_(
        ss,
        blocked ? "USER BLOCKED" : "USER UNBLOCKED",
        actorEmail,
        targetEmail,
        updated
      );

      return qaAppJson_({
        success: true,
        message: updated.displayName + (blocked ? " was blocked." : " was unblocked."),
        user: updated
      });
    }

    if (action === "savesettings") {
      qaAppAssertAdmin_(actor);

      const savedSettings = qaAppSaveSettings_(
        ss,
        request.settings || {},
        actorEmail
      );

      qaAppClearRuntimeCaches_();

      qaAppAudit_(
        ss,
        "SETTINGS UPDATED",
        actorEmail,
        "",
        { keys: Object.keys(savedSettings) }
      );

      return qaAppJson_({
        success: true,
        message: "QA settings were saved. Existing review rows were not changed.",
        settings: savedSettings
      });
    }

    if (action === "exportfilteredreviews") {
      const file = qaAppExportFilteredReviews_(
        ss,
        actor,
        request.filters || {}
      );

      qaAppAudit_(
        ss,
        "FILTERED REVIEWS EXPORTED",
        actorEmail,
        "",
        request.filters || {}
      );

      return qaAppJson_({
        success: true,
        data: file
      });
    }

    throw new Error("Unsupported React API action: " + action);
  } catch (error) {
    return qaAppJson_({
      success: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}


const QA_APP_RUNTIME_CACHE_SECONDS = 120;
const QA_APP_USERS_CACHE_KEY = "qa-app-runtime-users-v2";
const QA_APP_SETTINGS_CACHE_KEY = "qa-app-runtime-settings-v2";
const QA_APP_PRESENCE_CLEANUP_PROPERTY = "QA_APP_LAST_PRESENCE_CLEANUP";

function qaAppRequireSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(
      'Required QA app sheet "' + sheetName + '" was not found. Run qaAppSetup once.'
    );
  }

  return sheet;
}

function qaAppReadUsersFast_(ss) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(QA_APP_USERS_CACHE_KEY);

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      // Ignore an invalid cache entry and read the sheet.
    }
  }

  const sheet = qaAppRequireSheet_(ss, QA_APP_CONFIG.USERS_SHEET_NAME);

  if (sheet.getLastRow() < 2) return [];

  const values = sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      QA_APP_USER_HEADERS.length
    )
    .getValues();

  const users = values
    .map(function(row) {
      return qaAppUserFromRow_(row);
    })
    .filter(function(user) {
      return Boolean(user.email);
    });

  try {
    cache.put(
      QA_APP_USERS_CACHE_KEY,
      JSON.stringify(users),
      QA_APP_RUNTIME_CACHE_SECONDS
    );
  } catch (error) {
    // Cache failure must not block the app.
  }

  return users;
}

function qaAppGetUserByEmailFast_(ss, email) {
  const target = qaAppNormalizeEmail_(email);
  if (!target) return null;

  const users = qaAppReadUsersFast_(ss);

  for (let index = 0; index < users.length; index++) {
    if (users[index].email === target) return users[index];
  }

  return null;
}

function qaAppReadSettingsFast_(ss) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(QA_APP_SETTINGS_CACHE_KEY);

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      // Ignore an invalid cache entry and read the sheet.
    }
  }

  const defaults = qaAppDefaultSettings_();
  const sheet = qaAppRequireSheet_(ss, QA_APP_CONFIG.SETTINGS_SHEET_NAME);
  const values = qaAppSettingsMap_(sheet);

  const settings = {
    criteria: values.criteria || defaults.criteria,
    callCenters: values.callCenters || defaults.callCenters,
    statusOptions: values.statusOptions || defaults.statusOptions,
    rules: Object.assign({}, defaults.rules, values.rules || {})
  };

  try {
    cache.put(
      QA_APP_SETTINGS_CACHE_KEY,
      JSON.stringify(settings),
      QA_APP_RUNTIME_CACHE_SECONDS
    );
  } catch (error) {
    // Cache failure must not block the app.
  }

  return settings;
}

function qaAppClearRuntimeCaches_() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(QA_APP_USERS_CACHE_KEY);
    cache.remove(QA_APP_SETTINGS_CACHE_KEY);
  } catch (error) {
    // Cache cleanup must never block an admin action.
  }
}

function qaAppPresenceSheetFast_(ss) {
  return qaAppRequireSheet_(ss, QA_APP_CONFIG.PRESENCE_SHEET_NAME);
}

function qaAppCleanupPresenceMaybe_(sheet) {
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  const lastCleanup = Number(
    properties.getProperty(QA_APP_PRESENCE_CLEANUP_PROPERTY) || 0
  );

  if (lastCleanup && now - lastCleanup < 60 * 60 * 1000) {
    return;
  }

  qaAppCleanupPresence_(sheet);

  try {
    properties.setProperty(
      QA_APP_PRESENCE_CLEANUP_PROPERTY,
      String(now)
    );
  } catch (error) {
    // Cleanup timestamp failure must not block presence.
  }
}

function qaAppParseRequest_(e) {
  const raw = e && e.postData ? String(e.postData.contents || "") : "";
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("The React app sent invalid JSON.");
  }
}

function qaAppVerifyProxySecret_(providedSecret) {
  const expected = String(
    PropertiesService.getScriptProperties().getProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY) || ""
  ).trim();

  if (!expected) {
    throw new Error("The Apps Script proxy secret is not configured. Run qaAppSetup once.");
  }

  if (String(providedSecret || "").trim() !== expected) {
    throw new Error("Unauthorized React API request.");
  }
}

function qaAppJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function qaAppSpreadsheet_() {
  return SpreadsheetApp.openById(QA_APP_CONFIG.SPREADSHEET_ID);
}

function qaAppEnsureUsersSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.USERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.USERS_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_USER_HEADERS.length).setValues([QA_APP_USER_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_USER_HEADERS.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function qaAppEnsureSettingsSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.SETTINGS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.SETTINGS_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_SETTINGS_HEADERS.length).setValues([QA_APP_SETTINGS_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_SETTINGS_HEADERS.length);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 650);
  return sheet;
}

function qaAppEnsureAuditSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.AUDIT_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.AUDIT_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_AUDIT_HEADERS.length).setValues([QA_APP_AUDIT_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_AUDIT_HEADERS.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function qaAppEnsurePresenceSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.PRESENCE_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.PRESENCE_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_PRESENCE_HEADERS.length)
      .setValues([QA_APP_PRESENCE_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_PRESENCE_HEADERS.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function qaAppUpdatePresence_(ss, actor, currentPage, sessionId) {
  const sheet = qaAppPresenceSheetFast_(ss);
  const email = qaAppNormalizeEmail_(actor.email);
  const cleanSessionId = qaAppCleanText_(sessionId);

  if (!cleanSessionId) {
    throw new Error("Presence session ID is required.");
  }

  const row = [
    email,
    qaAppCleanText_(actor.displayName),
    qaAppCleanText_(actor.role),
    qaAppCleanText_(currentPage) || "QA App",
    new Date(),
    cleanSessionId
  ];

  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(2000);

  /*
   * Presence must never block login, reviews, or saving. If another heartbeat
   * owns the lock, return a successful presence object and let the next
   * heartbeat perform the write.
   */
  if (!locked) {
    return qaAppPresenceObject_(row, true);
  }

  try {
    const rowIndex = qaAppFindPresenceRow_(sheet, email, cleanSessionId);

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    qaAppCleanupPresenceMaybe_(sheet);
    return qaAppPresenceObject_(row, true);
  } finally {
    lock.releaseLock();
  }
}

function qaAppGetPresence_(ss) {
  const sheet = qaAppPresenceSheetFast_(ss);
  if (sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    QA_APP_PRESENCE_HEADERS.length
  ).getValues();

  const now = Date.now();
  const onlineWindowMs = Number(QA_APP_CONFIG.PRESENCE_ONLINE_SECONDS || 65) * 1000;
  const latestByEmail = {};

  rows.forEach(function(row) {
    const email = qaAppNormalizeEmail_(row[0]);
    if (!email) return;

    const lastSeenDate = row[4] instanceof Date ? row[4] : new Date(row[4]);
    const lastSeenMs = lastSeenDate && !isNaN(lastSeenDate.getTime())
      ? lastSeenDate.getTime()
      : 0;

    const candidate = qaAppPresenceObject_(row, now - lastSeenMs <= onlineWindowMs);
    candidate._lastSeenMs = lastSeenMs;

    if (!latestByEmail[email] || latestByEmail[email]._lastSeenMs < lastSeenMs) {
      latestByEmail[email] = candidate;
    }
  });

  return Object.keys(latestByEmail).map(function(email) {
    const item = latestByEmail[email];
    delete item._lastSeenMs;
    return item;
  });
}

function qaAppRemovePresence_(ss, actorEmail, sessionId) {
  const sheet = qaAppPresenceSheetFast_(ss);
  if (sheet.getLastRow() < 2) return;

  const email = qaAppNormalizeEmail_(actorEmail);
  const cleanSessionId = qaAppCleanText_(sessionId);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues();
  const rowsToDelete = [];

  values.forEach(function(row, index) {
    const rowEmail = qaAppNormalizeEmail_(row[0]);
    const rowSession = qaAppCleanText_(row[5]);
    if (rowEmail === email && (!cleanSessionId || rowSession === cleanSessionId)) {
      rowsToDelete.push(index + 2);
    }
  });

  rowsToDelete.reverse().forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });
}

function qaAppFindPresenceRow_(sheet, email, sessionId) {
  if (sheet.getLastRow() < 2) return 0;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (
      qaAppNormalizeEmail_(values[i][0]) === email &&
      qaAppCleanText_(values[i][5]) === sessionId
    ) {
      return i + 2;
    }
  }
  return 0;
}

function qaAppPresenceObject_(row, online) {
  const lastSeen = row[4] instanceof Date ? row[4] : new Date(row[4]);
  return {
    email: qaAppNormalizeEmail_(row[0]),
    displayName: qaAppCleanText_(row[1]),
    role: qaAppCleanText_(row[2]),
    currentPage: qaAppCleanText_(row[3]),
    lastSeen: lastSeen && !isNaN(lastSeen.getTime()) ? lastSeen.toISOString() : "",
    sessionId: qaAppCleanText_(row[5]),
    online: Boolean(online)
  };
}

function qaAppCleanupPresence_(sheet) {
  if (sheet.getLastRow() < 2) return;

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const dates = sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).getValues();
  const rowsToDelete = [];

  dates.forEach(function(row, index) {
    const value = row[0] instanceof Date ? row[0] : new Date(row[0]);
    if (!value || isNaN(value.getTime()) || value.getTime() < cutoff) {
      rowsToDelete.push(index + 2);
    }
  });

  rowsToDelete.reverse().forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });
}

function qaAppFormatHeader_(sheet, columns) {
  sheet.getRange(1, 1, 1, columns)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#24165f")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
}

function qaAppSeedCoreUsers_(ss) {
  const seeds = [
    qaAppBuildUser_("infojr.83@gmail.com", "Junior", "admin", true, false, "Primary administrator."),
    qaAppBuildUser_("barbara.kalchik8reserve@gmail.com", "Barbara", "admin", true, false, "Administrator."),
    qaAppBuildUser_(
      "shoultskelly22@gmail.com",
      "Kelly",
      "evaluator",
      true,
      true,
      "Guided Mode is enabled to provide friendly reminders and a final double-check before saving."
    )
  ];

  seeds.forEach(function(seed) {
    const existing = qaAppGetUserByEmail_(ss, seed.email);

    if (!existing) {
      qaAppWriteUser_(ss, seed, "qaAppSetup");
      return;
    }

    // Repair the required core-account access without creating duplicate rows.
    // This fixes Barbara when an older row exists but is blocked, has the wrong
    // role, or has missing permissions.
    const mustBeAdmin = QA_APP_CONFIG.ADMIN_EMAILS.indexOf(seed.email) >= 0;
    const repaired = Object.assign({}, existing, {
      displayName: seed.displayName,
      role: mustBeAdmin ? "admin" : existing.role,
      active: true,
      guidedMode: mustBeAdmin ? false : seed.guidedMode,
      permissions: mustBeAdmin
        ? {
            canSubmitReviews: true,
            canViewHistory: true,
            canEditAgentDetails: true,
            canEditCriteriaSelections: true,
            canEditCustomNotes: true
          }
        : existing.permissions,
      notes: existing.notes || seed.notes,
      createdAt: existing.createdAt || seed.createdAt
    });

    const needsRepair =
      repaired.displayName !== existing.displayName ||
      repaired.role !== existing.role ||
      repaired.active !== existing.active ||
      repaired.guidedMode !== existing.guidedMode ||
      JSON.stringify(repaired.permissions) !== JSON.stringify(existing.permissions);

    if (needsRepair) qaAppWriteUser_(ss, repaired, "qaAppSetup-repair");
  });
}

function qaAppBuildUser_(email, displayName, role, active, guidedMode, notes) {
  const isAdmin = role === "admin";
  return {
    email: qaAppNormalizeEmail_(email),
    displayName: qaAppCleanText_(displayName),
    role: role,
    active: active,
    guidedMode: isAdmin ? false : guidedMode,
    permissions: {
      canSubmitReviews: role !== "viewer",
      canViewHistory: true,
      canEditAgentDetails: role !== "viewer",
      canEditCriteriaSelections: role !== "viewer",
      canEditCustomNotes: role !== "viewer"
    },
    notes: qaAppCleanText_(notes),
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: "qaAppSetup"
  };
}

function qaAppReadUsers_(ss) {
  return qaAppReadUsersFast_(ss);
}

function qaAppGetUserByEmail_(ss, email) {
  return qaAppGetUserByEmailFast_(ss, email);
}

function qaAppUserFromRow_(row) {
  return {
    email: qaAppNormalizeEmail_(row[0]),
    displayName: qaAppCleanText_(row[1]),
    role: qaAppCleanText_(row[2]).toLowerCase() || "evaluator",
    active: qaAppBoolean_(row[3]),
    guidedMode: qaAppBoolean_(row[4]),
    permissions: {
      canSubmitReviews: qaAppBoolean_(row[5]),
      canViewHistory: qaAppBoolean_(row[6]),
      canEditAgentDetails: qaAppBoolean_(row[7]),
      canEditCriteriaSelections: qaAppBoolean_(row[8]),
      canEditCustomNotes: qaAppBoolean_(row[9])
    },
    notes: qaAppCleanText_(row[10]),
    createdAt: qaAppIso_(row[11]),
    updatedAt: qaAppIso_(row[12]),
    updatedBy: qaAppCleanText_(row[13])
  };
}

function qaAppWriteUser_(ss, user, actorEmail) {
  const sheet = qaAppEnsureUsersSheet_(ss);
  const now = new Date();
  const rowIndex = qaAppFindUserRow_(sheet, user.email);
  const existingCreatedAt = rowIndex > 0 ? sheet.getRange(rowIndex, 12).getValue() : "";
  const createdAt = existingCreatedAt || user.createdAt || now;

  const row = [
    user.email,
    user.displayName,
    user.role,
    Boolean(user.active),
    Boolean(user.guidedMode),
    Boolean(user.permissions.canSubmitReviews),
    Boolean(user.permissions.canViewHistory),
    Boolean(user.permissions.canEditAgentDetails),
    Boolean(user.permissions.canEditCriteriaSelections),
    Boolean(user.permissions.canEditCustomNotes),
    user.notes || "",
    createdAt,
    now,
    actorEmail
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  qaAppClearRuntimeCaches_();
  return qaAppGetUserByEmailFast_(ss, user.email);
}

function qaAppFindUserRow_(sheet, email) {
  const target = qaAppNormalizeEmail_(email);
  if (!target || sheet.getLastRow() < 2) return 0;

  const emails = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < emails.length; i++) {
    if (qaAppNormalizeEmail_(emails[i][0]) === target) return i + 2;
  }

  return 0;
}

function qaAppUpsertUser_(ss, rawUser, actorEmail) {
  const email = String(rawUser.email || "")
    .toLowerCase()
    .replace(/\u00A0/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();

  const displayName = qaAppCleanText_(rawUser.displayName);

  const isBarbaraGmail =
    email === "barbara.kalchik8reserve@gmail.com";

  const isJunior =
    email === "infojr.83@gmail.com";

  const emailIsValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!email || (!emailIsValid && !isBarbaraGmail)) {
    throw new Error(
      "Enter a valid email address. Received: " + email
    );
  }

  if (!displayName) {
    throw new Error("Enter the person’s name.");
  }

  const adminWhitelist =
    isJunior ||
    isBarbaraGmail ||
    QA_APP_CONFIG.ADMIN_EMAILS.indexOf(email) >= 0;

  let role = qaAppCleanText_(rawUser.role).toLowerCase();

  if (
    role !== "admin" &&
    role !== "evaluator" &&
    role !== "viewer"
  ) {
    role = "evaluator";
  }

  if (role === "admin" && !adminWhitelist) {
    throw new Error(
      "Only Junior and Barbara can be administrators."
    );
  }

  if (adminWhitelist) {
    role = "admin";
  }

  const existing = qaAppGetUserByEmail_(ss, email);
  const requestedPermissions = rawUser.permissions || {};
  const isAdmin = role === "admin";
  const isViewer = role === "viewer";

  const user = {
    email: email,
    displayName: displayName,
    role: role,
    active: isAdmin ? true : rawUser.active !== false,
    guidedMode: isAdmin
      ? false
      : qaAppBoolean_(rawUser.guidedMode),

    permissions: {
      canSubmitReviews: isAdmin
        ? true
        : isViewer
          ? false
          : rawUser.permissions
            ? qaAppBoolean_(
                requestedPermissions.canSubmitReviews
              )
            : true,

      canViewHistory: isAdmin
        ? true
        : rawUser.permissions
          ? qaAppBoolean_(
              requestedPermissions.canViewHistory
            )
          : true,

      canEditAgentDetails: isAdmin
        ? true
        : isViewer
          ? false
          : rawUser.permissions
            ? qaAppBoolean_(
                requestedPermissions.canEditAgentDetails
              )
            : true,

      canEditCriteriaSelections: isAdmin
        ? true
        : isViewer
          ? false
          : rawUser.permissions
            ? qaAppBoolean_(
                requestedPermissions.canEditCriteriaSelections
              )
            : true,

      canEditCustomNotes: isAdmin
        ? true
        : isViewer
          ? false
          : rawUser.permissions
            ? qaAppBoolean_(
                requestedPermissions.canEditCustomNotes
              )
            : true
    },

    notes: qaAppCleanText_(rawUser.notes),

    createdAt:
      existing && existing.createdAt
        ? new Date(existing.createdAt)
        : new Date()
  };

  return qaAppWriteUser_(ss, user, actorEmail);
}

function qaAppSetUserBlocked_(ss, targetEmail, blocked, actorEmail) {
  if (!targetEmail) throw new Error("Select a user account.");
  if (QA_APP_CONFIG.ADMIN_EMAILS.indexOf(targetEmail) >= 0) {
    throw new Error("Junior and Barbara administrator accounts cannot be blocked from this screen.");
  }

  const user = qaAppGetUserByEmail_(ss, targetEmail);
  if (!user) throw new Error("That QA app user was not found.");
  user.active = !blocked;
  return qaAppWriteUser_(ss, user, actorEmail);
}

function qaAppAssertAdmin_(user) {
  if (!user || user.role !== "admin" || QA_APP_CONFIG.ADMIN_EMAILS.indexOf(user.email) < 0) {
    throw new Error("Only Junior or Barbara can perform this admin action.");
  }
}

function qaAppSeedDefaultSettings_(ss) {
  const sheet = qaAppEnsureSettingsSheet_(ss);
  const defaults = qaAppDefaultSettings_();
  const existing = qaAppSettingsMap_(sheet);

  ["criteria", "callCenters", "statusOptions", "rules"].forEach(function(key) {
    if (!existing[key]) qaAppWriteSetting_(sheet, key, defaults[key], "qaAppSetup");
  });
}

function qaAppReadSettings_(ss) {
  return qaAppReadSettingsFast_(ss);
}

function qaAppSaveSettings_(ss, rawSettings, actorEmail) {
  const defaults = qaAppDefaultSettings_();
  const criteria = rawSettings.criteria || defaults.criteria;
  const callCenters = Array.isArray(rawSettings.callCenters)
    ? rawSettings.callCenters.map(qaAppCleanText_).filter(Boolean)
    : defaults.callCenters;
  const statusOptions = Array.isArray(rawSettings.statusOptions)
    ? rawSettings.statusOptions.map(qaAppCleanText_).filter(Boolean)
    : defaults.statusOptions;
  const rules = Object.assign({}, defaults.rules, rawSettings.rules || {});

  qaAppValidateCriteriaSettings_(criteria);
  if (!callCenters.length) throw new Error("Keep at least one call center.");
  if (!statusOptions.length) throw new Error("Keep at least one QA status option.");

  const sheet = qaAppEnsureSettingsSheet_(ss);
  qaAppWriteSetting_(sheet, "criteria", criteria, actorEmail);
  qaAppWriteSetting_(sheet, "callCenters", callCenters, actorEmail);
  qaAppWriteSetting_(sheet, "statusOptions", statusOptions, actorEmail);
  qaAppWriteSetting_(sheet, "rules", rules, actorEmail);

  qaAppClearRuntimeCaches_();
  return qaAppReadSettingsFast_(ss);
}

function qaAppValidateCriteriaSettings_(criteria) {
  ["CS", "Groups"].forEach(function(type) {
    if (!criteria || !Array.isArray(criteria[type]) || !criteria[type].length) {
      throw new Error(type + " must contain at least one criterion.");
    }

    criteria[type].forEach(function(item, index) {
      if (!qaAppCleanText_(item.name)) throw new Error(type + " criterion " + (index + 1) + " needs a name.");
      const points = Number(item.points);
      if (!isFinite(points) || points < 0) throw new Error(type + " criterion " + (index + 1) + " has invalid points.");
    });
  });
}

function qaAppSettingsMap_(sheet) {
  const result = {};
  if (sheet.getLastRow() < 2) return result;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  values.forEach(function(row) {
    const key = qaAppCleanText_(row[0]);
    if (!key || !row[1]) return;
    try {
      result[key] = JSON.parse(row[1]);
    } catch (error) {
      // Ignore a malformed row and use defaults for that setting.
    }
  });
  return result;
}

function qaAppWriteSetting_(sheet, key, value, actorEmail) {
  const lastRow = sheet.getLastRow();
  let rowIndex = 0;

  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (let i = 0; i < keys.length; i++) {
      if (qaAppCleanText_(keys[i][0]) === key) {
        rowIndex = i + 2;
        break;
      }
    }
  }

  const row = [key, JSON.stringify(value), new Date(), actorEmail];
  if (rowIndex) sheet.getRange(rowIndex, 1, 1, 4).setValues([row]);
  else sheet.appendRow(row);
}

function qaAppDefaultSettings_() {
  return {
    criteria: {
      CS: [
        { number: 1, name: "Agent is ready / available to receive call", points: 2, notes: "Correct greeting/intro; professional tone; sets purpose." },
        { number: 2, name: "Verification", points: 8, notes: "Confirms first name, last name, email, itinerary or confirmation number, hotel name, and booking dates before taking action." },
        { number: 3, name: "Acknowledges Need / Empathy / Reiteration", points: 10, notes: "Acknowledges request; restates need; uses empathetic language." },
        { number: 4, name: "Matrix Compliance (Process + Escalation + Tools)", points: 20, notes: "Follows correct matrix process, tools, escalation path, and timelines." },
        { number: 5, name: "Ownership & Solutioning", points: 10, notes: "Owns the issue, explains options, asks probing questions, and guides the guest." },
        { number: 6, name: "Efficiency & Expectations", points: 10, notes: "Sets clear expectations/timeframes, manages hold, and provides updates." },
        { number: 7, name: "Documentation Quality", points: 20, notes: "Notes are complete, accurate, and aligned with the action taken." },
        { number: 8, name: "Telephone Technique / Communication", points: 10, notes: "Clear pace, confidence, active listening, call control, professional language, no language barrier, and no dead air." },
        { number: 9, name: "Recap & Next Steps", points: 10, notes: "Summarizes outcome, confirms next step, and closes clearly." }
      ],
      Groups: [
        { number: 1, name: "Agent is ready to receive call", points: 4, notes: "Agent begins speaking within 3-5 seconds of being connected to the call." },
        { number: 2, name: "Correct Introduction", points: 6, notes: "Agent answers using the required Hotel Reservations introduction." },
        { number: 3, name: "Acknowledges Guest Request / Reiterates Needs", points: 5, notes: "Agent shows understanding of the guest's reason for calling and restates the request." },
        { number: 4, name: "Group Request Documentation Accuracy", points: 20, notes: "Agent captures all required information in the correct location, including Travel Agent information when applicable, and verifies email with phonetics." },
        { number: 5, name: "Honest Representation of HotelPlanner / Partner", points: 20, notes: "Agent answers honestly about the company and does not misrepresent the hotel or service." },
        { number: 6, name: "Ownership / Call Control / Guidance", points: 15, notes: "Agent asks leading questions, guides the guest, and completes the RFP." },
        { number: 7, name: "Telephone Techniques", points: 15, notes: "Agent is professional, actively listens, avoids speaking over the guest, avoids slang, uses a clear pace, and avoids dead air." },
        { number: 8, name: "Following Process and Closing Call", points: 15, notes: "Agent recaps details, gives the email and hotel response expectations, provides request credentials, offers more help, thanks the guest, and lets the guest disconnect first." }
      ]
    },
    callCenters: ["WNS", "Concentrix", "Buwelo-G", "Buwelo-C", "Telus"],
    statusOptions: ["✓ Followed", "✕ Markdown", "N/A", "Partial"],
    rules: {
      confirmationRequired: true,
      callIdRequired: true,
      guidedCallIdPattern: "^CA[0-9A-Fa-f]{32}$",
      noteRequiredForMarkdownOrPartial: true,
      csKpi: 90,
      groupsKpi: 85
    }
  };
}

function qaAppSaveReview_(ss, actor, rawReview, actorName) {
  if (!actor.permissions.canSubmitReviews) throw new Error("Your account cannot submit QA reviews.");
  if (!actor.permissions.canEditAgentDetails) {
    throw new Error("Your account cannot edit the agent and call details needed for a review.");
  }
  if (!actor.permissions.canEditCriteriaSelections) {
    throw new Error("Your account cannot select QA criterion statuses.");
  }

  const settings = qaAppReadSettings_(ss);
  const qaType = qaAppNormalizeQaType_(rawReview.qaType);
  if (!qaType) throw new Error("Select CS or Groups.");

  const definitions = settings.criteria[qaType];
  const statuses = settings.statusOptions;
  const answers = Array.isArray(rawReview.criteria) ? rawReview.criteria : [];
  const agentStartDate = qaAppDateFromInput_(rawReview.agentStartDate);
  const callDate = qaAppDateFromInput_(rawReview.callDate);
  const evaluator = actor.role === "admin"
    ? qaAppValidateEvaluator_(ss, rawReview.evaluator || actor.displayName)
    : actor.displayName;
  const agentName = qaAppCleanText_(rawReview.agentName);
  const callCenter = qaAppCleanText_(rawReview.callCenter);
  const callId = qaAppCleanText_(rawReview.callId).replace(/\s+/g, "");
  const confirmation = qaAppCleanText_(rawReview.confirmationNumber || rawReview.itineraryNumber);
  const callLength = qaAppCleanText_(rawReview.callLength);

  if (!agentStartDate) throw new Error("Add the agent start date.");
  if (!agentName) throw new Error("Add the agent name.");
  if (settings.callCenters.indexOf(callCenter) < 0) throw new Error("Select a valid call center.");
  if (settings.rules.callIdRequired && !callId) throw new Error("Add the Call ID.");
  if (settings.rules.confirmationRequired && confirmation.length < 2) {
    throw new Error("Add an itinerary, confirmation number, reservation number, or booking reference.");
  }
  if (!callLength) throw new Error("Add the call length.");
  if (!callDate) throw new Error("Add the date of the call.");

  if (actor.guidedMode) {
    let callIdPattern;
    try {
      callIdPattern = new RegExp(settings.rules.guidedCallIdPattern);
    } catch (error) {
      throw new Error("The Guided Mode Call ID pattern is invalid. Ask Junior or Barbara to repair it in Admin Control.");
    }

    if (!callIdPattern.test(callId)) {
      throw new Error("The Call ID must start with CA and contain exactly 32 hexadecimal characters after CA.");
    }
  }

  if (!actor.permissions.canEditCustomNotes) {
    const hasSubmittedNotes = answers.some(function(answer) {
      return Boolean(qaAppCleanText_(answer && answer.customNote));
    });
    if (hasSubmittedNotes) throw new Error("Your account cannot add custom notes.");
  }

  const calculatedCriteria = [];
  let finalScore = 0;
  let markdowns = 0;

  definitions.forEach(function(definition, index) {
    const answer = answers.find(function(item) {
      return Number(item.number) === Number(definition.number);
    }) || answers[index] || {};

    const status = qaAppCleanText_(answer.status);
    if (statuses.indexOf(status) < 0) {
      throw new Error("Select a status for criterion " + definition.number + ": " + definition.name + ".");
    }

    const customNote = qaAppCleanText_(answer.customNote);
    if (
      settings.rules.noteRequiredForMarkdownOrPartial &&
      (status === "✕ Markdown" || status === "Partial") &&
      !customNote
    ) {
      throw new Error("Add a clear note for criterion " + definition.number + " because " + status + " was selected.");
    }

    const points = Number(definition.points) || 0;
    const partialPoints = status === "Partial" ? points / 2 : "";
    let autoPoints = 0;
    if (status === "✓ Followed" || status === "N/A") autoPoints = points;
    if (status === "Partial") autoPoints = points / 2;
    if (status === "✕ Markdown") markdowns += 1;

    finalScore += autoPoints;
    calculatedCriteria.push({
      number: definition.number,
      name: definition.name,
      points: points,
      status: status,
      partialPoints: partialPoints,
      autoPoints: autoPoints,
      notes: definition.notes || "",
      customNote: customNote
    });
  });

  const kpiTarget = qaType === "Groups" ? Number(settings.rules.groupsKpi) : Number(settings.rules.csKpi);
  const result = finalScore >= kpiTarget ? "PASS" : "FAIL";
  const rowNumber = qaAppAppendReview_(ss, {
    savedTimestamp: new Date(),
    agentStartDate: agentStartDate,
    todayDate: new Date(),
    evaluator: evaluator,
    agentName: agentName,
    callCenter: callCenter,
    callId: callId,
    qaType: qaType,
    finalScore: finalScore,
    kpiTarget: kpiTarget,
    result: result,
    markdowns: markdowns,
    criteria: calculatedCriteria,
    confirmationNumber: confirmation,
    callLength: callLength,
    callDate: callDate
  });

  qaAppAudit_(ss, "REVIEW SAVED", actor.email, "", {
    rowNumber: rowNumber,
    evaluator: evaluator,
    agentName: agentName,
    callCenter: callCenter,
    qaType: qaType,
    finalScore: finalScore,
    actorName: actorName
  });

  try {
    CacheService.getScriptCache().remove(QA_APP_CONFIG.CACHE_KEY);
  } catch (error) {
    // Cache removal must never block saving.
  }

  return {
    success: true,
    message: "Review saved to Agents Reviewed row " + rowNumber + ".",
    review: {
      id: "agents-reviewed-" + rowNumber,
      rowNumber: rowNumber,
      savedTimestamp: new Date().toISOString(),
      agentStartDate: qaAppDateOnlyIso_(agentStartDate),
      reviewDate: qaAppDateOnlyIso_(new Date()),
      evaluator: evaluator,
      agentName: agentName,
      callCenter: callCenter,
      callId: callId,
      itineraryNumber: confirmation,
      emailSent: false,
      qaType: qaType,
      finalScore: finalScore,
      kpiTarget: kpiTarget,
      result: result,
      markdowns: markdowns,
      callLength: callLength,
      callDate: qaAppDateOnlyIso_(callDate),
      criteria: calculatedCriteria,
      issueSummary: calculatedCriteria
        .filter(function(item) { return item.customNote; })
        .map(function(item) { return item.name + " - " + item.status + " - " + item.customNote; })
        .join(" | ")
    }
  };
}

function qaAppValidateEvaluator_(ss, evaluatorName) {
  const target = qaAppCleanText_(evaluatorName);
  const users = qaAppReadUsers_(ss);
  const found = users.find(function(user) {
    return user.active && user.role !== "viewer" && user.displayName === target;
  });
  if (!found) throw new Error("Select an active evaluator.");
  return found.displayName;
}

function qaAppEnsureReviewHeaders_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.REVIEW_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.REVIEW_SHEET_NAME);

  const required = qaAppReviewHeaders_();
  let current = [];
  if (sheet.getLastColumn() > 0) {
    current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      .map(function(value) { return qaAppCleanText_(value); });
  }

  if (!current.length || !current[0]) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    qaAppFormatHeader_(sheet, required.length);
    return sheet;
  }

  required.forEach(function(header) {
    if (current.indexOf(header) < 0) {
      const newColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColumn).setValue(header);
      current.push(header);
    }
  });

  qaAppFormatHeader_(sheet, sheet.getLastColumn());
  return sheet;
}

function qaAppAppendReview_(ss, review) {
  const sheet = qaAppEnsureReviewHeaders_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return qaAppCleanText_(value); });
  const valuesByHeader = {};

  valuesByHeader["Saved Timestamp"] = review.savedTimestamp;
  valuesByHeader["Agent Start Date"] = review.agentStartDate;
  valuesByHeader["Today's Date"] = review.todayDate;
  valuesByHeader["Evaluator"] = review.evaluator;
  valuesByHeader["Agent Name"] = review.agentName;
  valuesByHeader["Call Center"] = review.callCenter;
  valuesByHeader["Call ID"] = review.callId;
  valuesByHeader["Email Sent?"] = false;
  valuesByHeader["QA Type"] = review.qaType;
  valuesByHeader["Final Score"] = review.finalScore;
  valuesByHeader["KPI Target"] = review.kpiTarget;
  valuesByHeader["Result"] = review.result;
  valuesByHeader["Markdowns"] = review.markdowns;

  for (let index = 1; index <= 9; index++) {
    const criterion = review.criteria[index - 1] || {};
    valuesByHeader["Criteria " + index + " #"] = criterion.number || "";
    valuesByHeader["Criteria " + index + " Name"] = criterion.name || "";
    valuesByHeader["Criteria " + index + " Max Points"] = criterion.points === undefined ? "" : criterion.points;
    valuesByHeader["Criteria " + index + " Status"] = criterion.status || "";
    valuesByHeader["Criteria " + index + " Partial Points"] = criterion.partialPoints === undefined ? "" : criterion.partialPoints;
    valuesByHeader["Criteria " + index + " Auto Points"] = criterion.autoPoints === undefined ? "" : criterion.autoPoints;
    valuesByHeader["Criteria " + index + " Notes / Issue Found"] = criterion.notes || "";
    valuesByHeader["Custom Note " + index] = criterion.customNote || "";
  }

  valuesByHeader["Itinerary Number"] = review.confirmationNumber || "";
  valuesByHeader["Length of Call"] = review.callLength || "";
  valuesByHeader["Date of Call"] = review.callDate || "";

  const rowValues = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header)
      ? valuesByHeader[header]
      : "";
  });

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);

    const index = qaAppHeaderIndex_(headers);
    qaAppFormatSavedReviewRow_(sheet, rowNumber, index);
    SpreadsheetApp.flush();
    return rowNumber;
  } finally {
    lock.releaseLock();
  }
}

function qaAppFormatSavedReviewRow_(sheet, row, index) {
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setVerticalAlignment("middle").setWrap(true);

  ["Saved Timestamp"].forEach(function(header) {
    if (index[header] !== undefined) sheet.getRange(row, index[header] + 1).setNumberFormat("m/d/yyyy h:mm AM/PM");
  });

  ["Agent Start Date", "Today's Date", "Date of Call"].forEach(function(header) {
    if (index[header] !== undefined) sheet.getRange(row, index[header] + 1).setNumberFormat("m/d/yyyy");
  });

  if (index["Length of Call"] !== undefined) {
    sheet.getRange(row, index["Length of Call"] + 1).setNumberFormat("@");
  }

  if (index["Email Sent?"] !== undefined) {
    const cell = sheet.getRange(row, index["Email Sent?"] + 1);
    cell.insertCheckboxes().setValue(false).setHorizontalAlignment("center");
  }

  if (index["Result"] !== undefined) {
    const resultCell = sheet.getRange(row, index["Result"] + 1);
    if (String(resultCell.getValue()).toUpperCase() === "PASS") {
      resultCell.setBackground("#d9ead3").setFontColor("#274e13").setFontWeight("bold");
    } else {
      resultCell.setBackground("#f4cccc").setFontColor("#990000").setFontWeight("bold");
    }
  }
}

function qaAppReviewHeaders_() {
  const headers = [
    "Saved Timestamp",
    "Agent Start Date",
    "Today's Date",
    "Evaluator",
    "Agent Name",
    "Call Center",
    "Call ID",
    "Email Sent?",
    "QA Type",
    "Final Score",
    "KPI Target",
    "Result",
    "Markdowns"
  ];

  for (let index = 1; index <= 9; index++) {
    headers.push("Criteria " + index + " #");
    headers.push("Criteria " + index + " Name");
    headers.push("Criteria " + index + " Max Points");
    headers.push("Criteria " + index + " Status");
    headers.push("Criteria " + index + " Partial Points");
    headers.push("Criteria " + index + " Auto Points");
    headers.push("Criteria " + index + " Notes / Issue Found");
  }

  for (let index = 1; index <= 9; index++) headers.push("Custom Note " + index);
  headers.push("Itinerary Number");
  headers.push("Length of Call");
  headers.push("Date of Call");
  return headers;
}

function qaAppHeaderIndex_(headers) {
  const result = {};
  headers.forEach(function(header, index) { result[header] = index; });
  return result;
}

function qaAppAudit_(ss, action, actorEmail, targetEmail, details) {
  try {
    const sheet = qaAppEnsureAuditSheet_(ss);
    sheet.appendRow([
      new Date(),
      action,
      actorEmail || "",
      targetEmail || "",
      JSON.stringify(details || {})
    ]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat("m/d/yyyy h:mm AM/PM");
  } catch (error) {
    // Audit failures must not erase a completed review or admin action.
  }
}

function qaAppNormalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function qaAppCleanText_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function qaAppBoolean_(value) {
  if (value === true) return true;
  if (value === false) return false;
  return ["true", "yes", "1", "active"].indexOf(String(value || "").trim().toLowerCase()) >= 0;
}

function qaAppIso_(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}

function qaAppDateOnlyIso_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function qaAppDateFromInput_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  const text = String(value || "").trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12, 0, 0, 0);
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(slashMatch[1]) - 1, Number(slashMatch[2]), 12, 0, 0, 0);
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function qaAppNormalizeQaType_(value) {
  const normalized = qaAppCleanText_(value).toLowerCase();
  if (normalized === "cs" || normalized === "customer service") return "CS";
  if (normalized === "groups" || normalized === "group") return "Groups";
  return "";
}


// -----------------------------------------------------------------------------
// CLEAN FILTERED EXCEL EXPORT
// -----------------------------------------------------------------------------

function qaAppExportFilteredReviews_(ss, actor, rawFilters) {
  if (!(actor.role === "admin" || actor.permissions.canViewHistory)) {
    throw new Error("Your account cannot export review history.");
  }

  const source = qaAppEnsureReviewHeaders_(ss);
  const lastRow = source.getLastRow();
  const lastColumn = source.getLastColumn();
  if (lastRow < 2) throw new Error("There are no saved reviews to export.");

  const values = source.getRange(1, 1, lastRow, lastColumn).getValues();
  const display = source.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = display[0].map(function(value) { return qaAppCleanText_(value); });
  const index = qaAppHeaderIndex_(headers);
  const filters = qaAppNormalizeExportFilters_(rawFilters);
  const reviews = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const rowValues = values[rowIndex];
    const rowDisplay = display[rowIndex];
    const review = qaAppExportReviewFromRow_(rowValues, rowDisplay, index, rowIndex + 1);
    if (!review.agentName) continue;
    if (!qaAppReviewMatchesExportFilters_(review, filters)) continue;
    reviews.push(review);
  }

  if (!reviews.length) throw new Error("No reviews match the selected filters.");

  const temp = SpreadsheetApp.create("QA Filtered Reviews Export " + new Date().getTime());
  const output = temp.getSheets()[0];
  output.setName("Reviews");
  output.clear();
  output.setHiddenGridlines(true);
  output.setFrozenRows(2);

  const purple = "#24165f";
  const lavender = "#ede9fe";
  const lightGray = "#f3f4f6";
  const green = "#d9ead3";
  const red = "#f4cccc";
  const amber = "#fff2cc";
  const border = "#c9c4d8";

  output.getRange("A1:F1").merge()
    .setValue(qaAppExportTitle_(filters))
    .setFontSize(16).setFontWeight("bold").setFontColor("#ffffff")
    .setBackground(purple).setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  output.setRowHeight(1, 34);
  output.getRange("A2:F2").merge()
    .setValue("Generated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy h:mm a") + " • " + reviews.length + " review" + (reviews.length === 1 ? "" : "s"))
    .setFontColor("#4b5563").setHorizontalAlignment("center");

  let row = 4;
  reviews.forEach(function(review, reviewIndex) {
    output.getRange(row, 1, 1, 6).merge()
      .setValue("Review " + (reviewIndex + 1) + " — " + review.agentName)
      .setBackground(purple).setFontColor("#ffffff")
      .setFontWeight("bold").setFontSize(12);
    row += 1;

    const meta = [
      ["Call Center", review.callCenter, "Evaluator", review.evaluator, "Review Date", review.reviewDate],
      ["Final Score", review.finalScore + "%", "Result", review.result, "QA Type", review.qaType],
      ["Call Length", review.callLength || "", "Call Date", review.callDate || "", "Itinerary", review.itineraryNumber || ""],
      ["Call ID", review.callId || "", "Agent Start Date", review.agentStartDate || "", "Email Sent", review.emailSent ? "Yes" : "No"]
    ];
    output.getRange(row, 1, meta.length, 6).setValues(meta).setWrap(true).setVerticalAlignment("middle");
    [1,3,5].forEach(function(column) {
      output.getRange(row, column, meta.length, 1).setFontWeight("bold").setBackground(lavender);
    });
    output.getRange(row, 1, meta.length, 6).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID);
    const resultCell = output.getRange(row + 1, 4);
    resultCell.setBackground(review.result === "PASS" ? green : red).setFontWeight("bold");
    row += meta.length + 1;

    output.getRange(row, 1, 1, 6).setValues([["#", "Criterion", "Max", "Score", "Status", "Notes"]])
      .setBackground("#4c3b87").setFontColor("#ffffff").setFontWeight("bold")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    row += 1;

    const criteria = review.criteria.filter(function(item) { return item.name || item.status || item.customNote; });
    const criteriaRows = criteria.map(function(item) {
      return [item.number, item.name, item.points, item.autoPoints, item.status, item.customNote || ""];
    });
    if (criteriaRows.length) {
      output.getRange(row, 1, criteriaRows.length, 6).setValues(criteriaRows).setWrap(true).setVerticalAlignment("top");
      output.getRange(row, 1, criteriaRows.length, 6).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID);
      criteria.forEach(function(item, idx) {
        const statusCell = output.getRange(row + idx, 5);
        if (item.status === "✕ Markdown") statusCell.setBackground(red);
        else if (item.status === "Partial") statusCell.setBackground(amber);
        else if (item.status === "✓ Followed") statusCell.setBackground(green);
        else statusCell.setBackground(lightGray);
      });
      row += criteriaRows.length;
    }

    output.getRange(row, 1).setValue("Review Notes").setFontWeight("bold").setBackground(lavender);
    output.getRange(row, 2, 1, 5).merge().setValue(review.issueSummary || "No review notes.").setWrap(true);
    output.getRange(row, 1, 1, 6).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID);
    row += 2;
  });

  output.setColumnWidth(1, 55);
  output.setColumnWidth(2, 310);
  output.setColumnWidth(3, 70);
  output.setColumnWidth(4, 75);
  output.setColumnWidth(5, 120);
  output.setColumnWidth(6, 390);
  output.getRange(1, 1, Math.max(1, row), 6).setFontFamily("Arial");
  output.autoResizeRows(1, Math.max(1, row));
  SpreadsheetApp.flush();

  const exportUrl = "https://docs.google.com/spreadsheets/d/" + temp.getId() + "/export?format=xlsx";
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    DriveApp.getFileById(temp.getId()).setTrashed(true);
    throw new Error("Google could not create the Excel file. HTTP " + response.getResponseCode() + ".");
  }

  const filename = qaAppExportFilename_(filters, reviews);
  const base64 = Utilities.base64Encode(response.getBlob().getBytes());
  DriveApp.getFileById(temp.getId()).setTrashed(true);
  return { filename: filename, base64: base64 };
}

function qaAppNormalizeExportFilters_(raw) {
  return {
    search: qaAppCleanText_(raw.search).toLowerCase(),
    result: qaAppCleanText_(raw.result || "ALL").toUpperCase(),
    center: qaAppCleanText_(raw.center || "ALL"),
    qaType: qaAppCleanText_(raw.qaType || "ALL"),
    evaluator: qaAppCleanText_(raw.evaluator || "ALL"),
    emailStatus: qaAppCleanText_(raw.emailStatus || "ALL").toUpperCase(),
    dateFrom: qaAppCleanText_(raw.dateFrom),
    dateTo: qaAppCleanText_(raw.dateTo)
  };
}

function qaAppExportReviewFromRow_(rowValues, rowDisplay, index, rowNumber) {
  function val(header) {
    return index[header] === undefined ? "" : rowValues[index[header]];
  }
  function text(header) {
    return index[header] === undefined ? "" : qaAppCleanText_(rowDisplay[index[header]]);
  }
  const qaType = text("QA Type") || "CS";
  const score = Number(val("Final Score")) || 0;
  const kpi = Number(val("KPI Target")) || (qaType === "Groups" ? 85 : 90);
  const criteria = [];
  for (let i = 1; i <= 9; i++) {
    criteria.push({
      number: text("Criteria " + i + " #") || i,
      name: text("Criteria " + i + " Name"),
      points: val("Criteria " + i + " Max Points") === "" ? "" : Number(val("Criteria " + i + " Max Points")),
      status: text("Criteria " + i + " Status"),
      partialPoints: val("Criteria " + i + " Partial Points") === "" ? "" : Number(val("Criteria " + i + " Partial Points")),
      autoPoints: val("Criteria " + i + " Auto Points") === "" ? "" : Number(val("Criteria " + i + " Auto Points")),
      notes: text("Criteria " + i + " Notes / Issue Found"),
      customNote: text("Custom Note " + i)
    });
  }
  const notes = criteria.filter(function(item) { return item.customNote; }).map(function(item) {
    return item.name + " — " + item.status + ": " + item.customNote;
  }).join("\n");
  return {
    rowNumber: rowNumber,
    reviewDate: qaAppExportDateText_(val("Today's Date") || val("Saved Timestamp")),
    savedDate: qaAppExportDateIso_(val("Today's Date") || val("Saved Timestamp")),
    agentStartDate: qaAppExportDateText_(val("Agent Start Date")),
    evaluator: text("Evaluator"),
    agentName: text("Agent Name"),
    callCenter: text("Call Center"),
    callId: text("Call ID"),
    itineraryNumber: text("Itinerary Number"),
    emailSent: qaAppBoolean_(val("Email Sent?")),
    qaType: qaType,
    finalScore: score,
    kpiTarget: kpi,
    result: text("Result") || (score >= kpi ? "PASS" : "FAIL"),
    callLength: text("Length of Call"),
    callDate: qaAppExportDateText_(val("Date of Call")),
    criteria: criteria,
    issueSummary: notes
  };
}

function qaAppReviewMatchesExportFilters_(review, filters) {
  if (filters.result !== "ALL" && review.result.toUpperCase() !== filters.result) return false;
  if (filters.center !== "ALL" && review.callCenter !== filters.center) return false;
  if (filters.qaType !== "ALL" && review.qaType !== filters.qaType) return false;
  if (filters.evaluator !== "ALL" && review.evaluator !== filters.evaluator) return false;
  if (filters.emailStatus === "SENT" && !review.emailSent) return false;
  if (filters.emailStatus === "NOT_SENT" && review.emailSent) return false;
  if (filters.dateFrom && review.savedDate < filters.dateFrom) return false;
  if (filters.dateTo && review.savedDate > filters.dateTo) return false;
  if (filters.search) {
    const haystack = [review.agentName, review.callCenter, review.callId, review.itineraryNumber, review.evaluator].join(" ").toLowerCase();
    if (haystack.indexOf(filters.search) < 0) return false;
  }
  return true;
}

function qaAppExportDateIso_(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return qaAppCleanText_(value).slice(0, 10);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function qaAppExportDateText_(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return qaAppCleanText_(value);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "MM/dd/yyyy");
}

function qaAppExportTitle_(filters) {
  return filters.center !== "ALL" ? qaAppTitleCase_(filters.center) + " Reviews" : "QA Reviews";
}

function qaAppExportFilename_(filters, reviews) {
  const prefix = filters.center !== "ALL" ? qaAppTitleCase_(filters.center) + " Reviews" : "Reviews";
  let datePart = "";
  if (filters.dateFrom && filters.dateTo) {
    datePart = filters.dateFrom === filters.dateTo ? filters.dateFrom : filters.dateFrom + " to " + filters.dateTo;
  } else if (filters.dateFrom) datePart = "From " + filters.dateFrom;
  else if (filters.dateTo) datePart = "Through " + filters.dateTo;
  else {
    const dates = reviews.map(function(r) { return r.savedDate; }).filter(Boolean).sort();
    datePart = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + " to " + dates[dates.length - 1]) : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return (prefix + " " + datePart + ".xlsx").replace(/[\\/:*?"<>|]/g, "-");
}

function qaAppTitleCase_(value) {
  return String(value || "").toLowerCase().replace(/(^|[\s-])\S/g, function(letter) { return letter.toUpperCase(); });
}
