// Code.gs
// Google Sheet QA Tracker
// SAFE VERSION:
// - Setup Full QA Tracker does NOT delete Agents Reviewed data.
// - Save button forced to G21/G22.
// - G21 = Save Review / Saving...
// - G22 = clickable checkbox save button.
// - I11 = Custom Notes.
// - I12:I20 = custom notes with short preview + full hover note after 5 seconds.
// - Supports CS and Groups criteria.
// - Creates separate QA tabs for Junior, Barbara, and Kelly.
// - All QA tabs save into the same "Agents Reviewed" destination tab.
// - Uses DocumentLock so simultaneous saves cannot overwrite each other.
// - Reads main review details from C3:C10, plus F8 Length of Call and F9 Date of Call.
// - Agent Phone Start Date C3 and Today's Date C4 are REQUIRED before saving.
// - C3 allows dates from the last 6 years OR any date in 2026.
// - C4 validates today's actual date using INT(C4)=TODAY().
// - C4 auto-fills today's date when selected/clicked.
// - Loading popup/toast added to setup/fix/load actions.
// - Time-zone-safe date repair added for C3/C4 without changing the rest of the tracker.
// - Kelly saves through an owner-installed edit trigger so the protected results tab stays locked.
// - Evaluators: Junior / Barbara / Kelly. Each personal tab is locked to its evaluator name.
// - C5 Evaluator is NOT cleared after saving.
// - Call Center options: WNS, Concentrix, Buwelo-G, Buwelo-C, Telus.
// - Call Center accepts lowercase/variations and normalizes automatically.
// - Saves completed review into "Agents Reviewed".
// - Column H is "Email Sent?"; checking it creates an A:CH snapshot in "emails sent details".
// - Length of Call and Date of Call are appended safely to the far right of Agents Reviewed.

const CONFIG = {
  TEMPLATE_SHEET_NAME: "Errors Found",
  DESTINATION_SHEET_NAME: "Agents Reviewed",
  EMAIL_DETAILS_SHEET_NAME: "emails sent details",
  EMAIL_SENT_COLUMN: 8,
  EMAIL_SENT_HEADER: "Email Sent?",
  EMAIL_DETAILS_COPY_START_COLUMN: 1,
  EMAIL_DETAILS_COPY_END_COLUMN: 86, // Column CH
  EMAIL_DETAILS_METADATA_COLUMNS: 4,
  OWNER_EDIT_TRIGGER_HANDLER: "qaOwnerOnEdit",
  QA_USERS_PROPERTY_KEY: "QA_TRACKER_DYNAMIC_USERS_V1",

  // Kelly-only form protection. This does not affect Junior, Barbara,
  // Agents Reviewed, the email log, or the React web API.
  KELLY_SHEET_NAME: "Kelly",
  KELLY_PROTECTION_DESCRIPTION: "Kelly QA Form Lock",
  KELLY_ALLOWED_EDIT_RANGES: [
    "C3",       // Agent Start Date
    "C6:C10",  // Agent, Call Center, Call ID, QA Type, Itinerary
    "F8:F9",   // Length of Call and Date of Call
    "E12:E20", // QA status selections only
    "I12:I20", // Custom notes
    "G22"       // Save checkbox
  ],

  QA_USER_SHEETS: [
    { sheetName: "Junior", evaluator: "Junior" },
    { sheetName: "Barbara", evaluator: "Barbara" },
    { sheetName: "Kelly", evaluator: "Kelly" }
  ],

  SAVE_BUTTON_LABEL_CELL: "G21",
  SAVE_BUTTON_CELL: "G22",

  CUSTOM_NOTES_HEADER_CELL: "I11",
  CUSTOM_NOTES_RANGE: "I12:I20",
  CUSTOM_NOTES_START_ROW: 12,
  CUSTOM_NOTES_END_ROW: 20,
  CUSTOM_NOTES_COL: 9,
  CUSTOM_NOTES_VISIBLE_CHARS: 8,
  CUSTOM_NOTES_PLACEHOLDER: "Your text will turn into notes after 5 seconds once you finish.",
  CUSTOM_NOTES_DELAY_MS: 5000,

  OLD_BUTTON_CELLS_TO_CLEAR: ["H1", "I1", "H20", "H21", "I20", "I21", "G20"],

  REVIEW_DATE_CELL: "C3",
  TODAY_DATE_CELL: "C4",
  EVALUATOR_CELL: "C5",
  AGENT_NAME_CELL: "C6",
  CALL_CENTER_CELL: "C7",
  CALL_ID_CELL: "C8",
  QA_TYPE_CELL: "C9",
  ITINERARY_NUMBER_CELL: "C10",
  ITINERARY_NUMBER_LABEL_CELL: "B10",

  CALL_LENGTH_CELL: "F8",
  CALL_DATE_CELL: "F9",
  CALL_LENGTH_HEADER: "Length of Call",
  CALL_DATE_HEADER: "Date of Call",

  FINAL_SCORE_CELL: "F4",
  KPI_TARGET_CELL: "F5",
  RESULT_CELL: "F6",
  MARKDOWNS_CELL: "F7",

  CRITERIA_START_ROW: 12,
  CRITERIA_END_ROW: 20,

  CRITERIA_NUMBER_COL: 2,
  CRITERIA_NAME_COL: 3,
  MAX_POINTS_COL: 4,
  STATUS_COL: 5,
  PARTIAL_POINTS_COL: 6,
  AUTO_POINTS_COL: 7,
  NOTES_COL: 8,

  CLEAR_RANGES_AFTER_SAVE: [
    "C3:C4",
    "C6:C10",
    "F8:F9",
    "E12:E20",
    "F12:F20",
    "H12:H20",
    "I12:I20"
  ]
};

const QA_ACCESS_CONFIG = {
  JUNIOR_EMAIL: "infojr.83@gmail.com",
  BARBARA_EMAILS: [
    "barbara.kalchik8reserve@gmail.com",
    "barbara.kalchik@hotelplanner.com"
  ],
  KELLY_EMAIL: "shoultskelly22@gmail.com",
  KELLY_EMAILS: [
    "shoultskelly22@gmail.com",
    "kelly.shoults@hotelplanner.com"
  ],
  RESULTS_PROTECTION_DESCRIPTION: "QA Manager Lock - Agents Reviewed",
  EMAIL_LOG_PROTECTION_DESCRIPTION: "QA Manager Lock - Email Sent Details"
};

const EVALUATOR_OPTIONS = ["Junior", "Barbara", "Kelly"]; // Core evaluators
const STATUS_OPTIONS = ["✓ Followed", "✕ Markdown", "N/A", "Partial"];
const QA_TYPE_OPTIONS = ["CS", "Groups"];

const CALL_CENTER_OPTIONS = [
  "WNS",
  "Concentrix",
  "Buwelo-G",
  "Buwelo-C",
  "Telus"
];

const CS_CRITERIA = [
  {
    number: 1,
    name: "Agent is ready / available to receive call",
    points: 2,
    notes: "Correct greeting/intro; professional tone; sets purpose."
  },
  {
    number: 2,
    name: "Verification",
    points: 8,
    notes: "Confirms first name, last name, email, itinerary number, hotel name, and booking dates before taking action."
  },
  {
    number: 3,
    name: "Acknowledges Need / Empathy / Reiteration",
    points: 10,
    notes: "Acknowledges request; restates need; uses empathetic language."
  },
  {
    number: 4,
    name: "Matrix Compliance (Process + Escalation + Tools)",
    points: 20,
    notes: "Follows correct matrix process, tools, escalation path, and timelines."
  },
  {
    number: 5,
    name: "Ownership & Solutioning",
    points: 10,
    notes: "Owns the issue, explains options, asks probing questions, and guides the guest."
  },
  {
    number: 6,
    name: "Efficiency & Expectations",
    points: 10,
    notes: "Sets clear expectations/timeframes, manages hold, and provides updates."
  },
  {
    number: 7,
    name: "Documentation Quality",
    points: 20,
    notes: "Notes are complete, accurate, and aligned with the action taken."
  },
  {
    number: 8,
    name: "Telephone Technique / Communication",
    points: 10,
    notes: "Clear pace, confidence, active listening, call control, professional language, no language barrier, and no dead air."
  },
  {
    number: 9,
    name: "Recap & Next Steps",
    points: 10,
    notes: "Summarizes outcome, confirms next step, and closes clearly."
  }
];

const GROUPS_CRITERIA = [
  {
    number: 1,
    name: "Agent is ready to receive call",
    points: 4,
    notes: "Agent begins speaking within 3-5 seconds of being connected to the call."
  },
  {
    number: 2,
    name: "Correct Introduction",
    points: 6,
    notes: "Agent answers using: Thank you for calling Hotel Reservations. My name is ____, how may I assist you?"
  },
  {
    number: 3,
    name: "Acknowledges Guest Request / Reiterates Needs",
    points: 5,
    notes: "Agent shows understanding of the guest's reason for calling, such as creating a room block, booking into an existing block, individual reservation, same-day check-in, or extended stay."
  },
  {
    number: 4,
    name: "Group Request Documentation Accuracy",
    points: 20,
    notes: "Agent captures all requested information and enters it in the correct location on the group request form, including Travel Agent information when applicable, using phonetics to verify email."
  },
  {
    number: 5,
    name: "Honest Representation of HotelPlanner / Partner",
    points: 20,
    notes: "If the guest asks about the agent's location or company, agent answers honestly using the designated group-request verbiage and does not misrepresent the hotel or service."
  },
  {
    number: 6,
    name: "Ownership / Call Control / Guidance",
    points: 15,
    notes: "Agent displays ownership throughout the call by asking leading questions, guiding the guest, and completing the RFP."
  },
  {
    number: 7,
    name: "Telephone Techniques",
    points: 15,
    notes: "Agent is professional, actively listens, avoids speaking over the guest, avoids slang/jargon, uses a clear pace, and avoids dead air."
  },
  {
    number: 8,
    name: "Following Process and Closing Call",
    points: 15,
    notes: "Agent recaps essential details and provides next steps: email within 15 minutes, recommend giving hotels at least 24 hours to respond, provides request ID and password, assists with password if needed, offers further assistance, thanks guest, and allows guest to disconnect first."
  }
];


// -----------------------------------------------------------------------------
// DYNAMIC QA PEOPLE / TAB MANAGEMENT
// -----------------------------------------------------------------------------
// Core users remain in CONFIG.QA_USER_SHEETS. Additional people added from the
// QA Tracker menu are stored safely in Document Properties, so they survive
// refreshes and future script executions without changing saved review data.

function getQaUserPropertyStore_() {
  return PropertiesService.getDocumentProperties() ||
    PropertiesService.getScriptProperties();
}

function getDynamicQaUsers_() {
  const raw = getQaUserPropertyStore_()
    .getProperty(CONFIG.QA_USERS_PROPERTY_KEY);

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(item => ({
        sheetName: String(item && item.sheetName || "").trim(),
        evaluator: String(item && item.evaluator || "").trim(),
        email: String(item && item.email || "").trim().toLowerCase(),
        canEditReviewed: Boolean(item && item.canEditReviewed),
        createdAt: String(item && item.createdAt || "")
      }))
      .filter(item => item.sheetName && item.evaluator && item.email);
  } catch (error) {
    console.error(`Could not read dynamic QA users: ${error.message}`);
    return [];
  }
}

function saveDynamicQaUsers_(users) {
  const cleaned = (Array.isArray(users) ? users : []).map(item => ({
    sheetName: String(item.sheetName || "").trim(),
    evaluator: String(item.evaluator || "").trim(),
    email: String(item.email || "").trim().toLowerCase(),
    canEditReviewed: Boolean(item.canEditReviewed),
    createdAt: String(item.createdAt || new Date().toISOString())
  }));

  getQaUserPropertyStore_().setProperty(
    CONFIG.QA_USERS_PROPERTY_KEY,
    JSON.stringify(cleaned)
  );
}

function getAllQaUserConfigs_() {
  const combined = CONFIG.QA_USER_SHEETS
    .map(item => ({
      sheetName: String(item.sheetName || "").trim(),
      evaluator: String(item.evaluator || "").trim(),
      email: "",
      canEditReviewed: false,
      isCore: true
    }))
    .concat(
      getDynamicQaUsers_().map(item => Object.assign({}, item, { isCore: false }))
    );

  const seenSheets = new Set();
  const seenEvaluators = new Set();

  return combined.filter(item => {
    const sheetKey = item.sheetName.toLowerCase();
    const evaluatorKey = item.evaluator.toLowerCase();

    if (!sheetKey || !evaluatorKey) return false;
    if (seenSheets.has(sheetKey) || seenEvaluators.has(evaluatorKey)) return false;

    seenSheets.add(sheetKey);
    seenEvaluators.add(evaluatorKey);
    return true;
  });
}

function getEvaluatorOptions_() {
  const options = getAllQaUserConfigs_()
    .map(item => String(item.evaluator || "").trim())
    .filter(Boolean);

  return Array.from(new Set(options));
}

function getAgentsReviewedEditorEmails_() {
  const emails = getQaManagerEmails_().concat(
    getDynamicQaUsers_()
      .filter(item => item.canEditReviewed)
      .map(item => item.email)
  );

  return Array.from(
    new Set(
      emails
        .map(email => String(email || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function normalizeQaPersonName_(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSafeQaSheetName_(personName) {
  const cleaned = normalizeQaPersonName_(personName)
    .replace(/[\\/\?\*\[\]:]/g, "-")
    .substring(0, 100)
    .trim();

  return cleaned;
}

function isValidQaEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function addQaPerson() {
  const ui = SpreadsheetApp.getUi();

  try {
    assertQaManager_();
  } catch (error) {
    ui.alert(error.message);
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const nameResponse = ui.prompt(
    "Add QA Person",
    "Enter the person's full name. A new QA tab will be created with this name.",
    ui.ButtonSet.OK_CANCEL
  );

  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;

  const evaluatorName = normalizeQaPersonName_(nameResponse.getResponseText());
  const sheetName = makeSafeQaSheetName_(evaluatorName);

  if (!evaluatorName || !sheetName) {
    ui.alert("A valid person name is required.");
    return;
  }

  const allUsers = getAllQaUserConfigs_();
  const duplicateName = allUsers.some(item =>
    String(item.evaluator || "").trim().toLowerCase() === evaluatorName.toLowerCase()
  );

  if (duplicateName) {
    ui.alert(`"${evaluatorName}" is already configured as a QA person.`);
    return;
  }

  if (ss.getSheetByName(sheetName)) {
    ui.alert(
      `A tab named "${sheetName}" already exists. No tab or data was changed.`
    );
    return;
  }

  const emailResponse = ui.prompt(
    "Add QA Person",
    `Enter the Google account email for ${evaluatorName}.`,
    ui.ButtonSet.OK_CANCEL
  );

  if (emailResponse.getSelectedButton() !== ui.Button.OK) return;

  const email = String(emailResponse.getResponseText() || "")
    .trim()
    .toLowerCase();

  if (!isValidQaEmail_(email)) {
    ui.alert("Please enter a valid email address.");
    return;
  }

  const knownEmails = getQaManagerEmails_()
    .concat(QA_ACCESS_CONFIG.KELLY_EMAILS || [QA_ACCESS_CONFIG.KELLY_EMAIL])
    .concat(getDynamicQaUsers_().map(item => item.email))
    .map(item => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  if (knownEmails.includes(email)) {
    ui.alert(`The email ${email} is already assigned to another QA person.`);
    return;
  }

  const permissionResponse = ui.alert(
    "Agents Reviewed Permission",
    `Should ${evaluatorName} be allowed to edit the "${CONFIG.DESTINATION_SHEET_NAME}" tab?\n\nYES = can edit it\nNO = cannot edit it`,
    ui.ButtonSet.YES_NO_CANCEL
  );

  if (permissionResponse === ui.Button.CANCEL) return;

  const canEditReviewed = permissionResponse === ui.Button.YES;
  const template = getTemplateSheet_(ss);

  if (!template) {
    ui.alert(
      `The template tab "${CONFIG.TEMPLATE_SHEET_NAME}" was not found. No changes were made.`
    );
    return;
  }

  const lock = LockService.getDocumentLock();
  let createdSheet = null;
  let userSaved = false;
  let editorAdded = false;

  showLoading_(`Creating the QA account and tab for ${evaluatorName}...`);

  try {
    lock.waitLock(30000);

    // Give the person edit access to the spreadsheet. Google may block this if
    // the person running the menu is not allowed to share the file.
    ss.addEditor(email);
    editorAdded = true;

    createdSheet = template.copyTo(ss).setName(sheetName);

    const dynamicUsers = getDynamicQaUsers_();
    dynamicUsers.push({
      sheetName: sheetName,
      evaluator: evaluatorName,
      email: email,
      canEditReviewed: canEditReviewed,
      createdAt: new Date().toISOString()
    });
    saveDynamicQaUsers_(dynamicUsers);
    userSaved = true;

    createdSheet.getRange(CONFIG.EVALUATOR_CELL).setValue(evaluatorName);
    setupQaSheet_(createdSheet, evaluatorName);
    clearCurrentReview_(createdSheet);
    fixEvaluatorDropdowns(false);

    const reviewedSheet = ss.getSheetByName(CONFIG.DESTINATION_SHEET_NAME);
    if (reviewedSheet) {
      protectQaManagerSheet_(
        reviewedSheet,
        QA_ACCESS_CONFIG.RESULTS_PROTECTION_DESCRIPTION
      );
    }

    SpreadsheetApp.flush();
    createdSheet.activate();
    showDone_(`${evaluatorName} was added successfully.`);

    ui.alert(
      "QA Person Added",
      `${evaluatorName} was added successfully.\n\nEmail: ${email}\nNew tab: ${sheetName}\nAgents Reviewed access: ${canEditReviewed ? "Can edit" : "Cannot edit"}\n\nThe evaluator dropdowns were updated automatically.`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    // Roll back only the new items created by this operation. Existing tabs,
    // reviews, protections, formulas, and API code are left untouched.
    if (userSaved) {
      const remainingUsers = getDynamicQaUsers_().filter(item =>
        item.email.toLowerCase() !== email ||
        item.evaluator.toLowerCase() !== evaluatorName.toLowerCase()
      );
      saveDynamicQaUsers_(remainingUsers);
    }

    if (createdSheet) {
      try {
        ss.deleteSheet(createdSheet);
      } catch (ignored) {
        // Keep the original error below.
      }
    }

    if (editorAdded) {
      try {
        ss.removeEditor(email);
      } catch (ignored) {
        // Domain or shared-drive access may still keep the person on the file.
      }
    }

    ui.alert(
      "Person Was Not Added",
      `No existing QA data was changed. Google returned this error:\n\n${error.message}\n\nBarbara must have permission to share the spreadsheet and manage its protected sheets.`,
      ui.ButtonSet.OK
    );
  } finally {
    try {
      lock.releaseLock();
    } catch (ignored) {
      // The lock may not have been acquired if Google stopped the operation early.
    }
  }
}

function getQaUserConfigForSheet_(sheetOrName) {
  const sheetName = typeof sheetOrName === "string"
    ? sheetOrName
    : sheetOrName && sheetOrName.getName
      ? sheetOrName.getName()
      : "";

  return getAllQaUserConfigs_().find(item => item.sheetName === sheetName) || null;
}

function isQaFormSheet_(sheet) {
  if (!sheet) return false;

  const sheetName = sheet.getName();
  return sheetName === CONFIG.TEMPLATE_SHEET_NAME || Boolean(getQaUserConfigForSheet_(sheetName));
}

function getActiveQaSheet_(showAlert = true) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (isQaFormSheet_(sheet)) return sheet;

  if (showAlert) {
    SpreadsheetApp.getUi().alert(
      "Please open one of the configured QA evaluator tabs and try again."
    );
  }

  return null;
}

function getTemplateSheet_(ss) {
  const template = ss.getSheetByName(CONFIG.TEMPLATE_SHEET_NAME);

  if (template) return template;

  const allUsers = getAllQaUserConfigs_();

  for (let i = 0; i < allUsers.length; i++) {
    const possibleTemplate = ss.getSheetByName(allUsers[i].sheetName);
    if (possibleTemplate) return possibleTemplate;
  }

  return null;
}

function setupAllQaUserTabs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const template = getTemplateSheet_(ss);

  if (!template) {
    throw new Error(
      `The template sheet "${CONFIG.TEMPLATE_SHEET_NAME}" was not found. Keep your original QA form tab and name it "${CONFIG.TEMPLATE_SHEET_NAME}".`
    );
  }

  getAllQaUserConfigs_().forEach(userConfig => {
    let sheet = ss.getSheetByName(userConfig.sheetName);
    let wasCreated = false;

    if (!sheet) {
      sheet = template.copyTo(ss).setName(userConfig.sheetName);
      sheet.getRange(CONFIG.EVALUATOR_CELL).setValue(userConfig.evaluator);
      wasCreated = true;
    }

    setupQaSheet_(sheet, userConfig.evaluator);

    if (wasCreated) {
      clearCurrentReview_(sheet);
    }
  });
}

function setupQaSheet_(sheet, evaluatorName) {
  setupSaveButtonForSheet_(sheet);
  setupCustomNotesForSheet_(sheet);
  setupItineraryField_(sheet);
  setupCallDetailsForSheet_(sheet);
  setupDropdownsAndFormulas_(sheet);
  setupDateRules_(sheet);
  forceCriteriaDropdownsForSheet_(sheet);
  forceCriteriaFormulasForSheet_(sheet);
  fixCallCenterDropdownForSheet_(sheet);
  setEvaluatorForSheet_(sheet, evaluatorName || getConfiguredEvaluatorForSheet_(sheet));

  // The Kelly lock must be applied last because the normal setup functions
  // write formulas, criteria descriptions, and formatting into protected cells.
  if (isKellySheet_(sheet)) {
    setupKellyFieldRules_(sheet);
    protectKellyTab_(sheet);
  }
}

function getConfiguredEvaluatorForSheet_(sheet) {
  const config = getQaUserConfigForSheet_(sheet);
  return config ? config.evaluator : "";
}

function setEvaluatorForSheet_(sheet, evaluatorName) {
  const evaluatorCell = sheet.getRange(CONFIG.EVALUATOR_CELL);

  // Kelly has her own locked tab, so C5 must always be Kelly and must not use
  // a dropdown. Removing the validation prevents the false "Invalid" warning.
  if (isKellySheet_(sheet)) {
    evaluatorCell
      .clearDataValidations()
      .setNumberFormat("@")
      .setValue("Kelly")
      .setNote("This evaluator is locked to Kelly on the Kelly tab.");
    return;
  }

  const configuredEvaluator = evaluatorName || getConfiguredEvaluatorForSheet_(sheet);
  const currentValue = String(evaluatorCell.getValue() || "").trim();

  const evaluatorRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(getEvaluatorOptions_(), true)
    .setAllowInvalid(false)
    .setHelpText("Select a configured QA evaluator.")
    .build();

  evaluatorCell.clearDataValidations();

  if (!getEvaluatorOptions_().includes(currentValue)) {
    evaluatorCell.setValue(
      getEvaluatorOptions_().includes(configuredEvaluator)
        ? configuredEvaluator
        : getEvaluatorOptions_()[0]
    );
  }

  evaluatorCell.setDataValidation(evaluatorRule);
}

function setupItineraryField_(sheet) {
  sheet.getRange(CONFIG.ITINERARY_NUMBER_LABEL_CELL)
    .setValue("Itinerary Number")
    .setFontWeight("bold")
    .setHorizontalAlignment("right")
    .setVerticalAlignment("middle");

  sheet.getRange(CONFIG.ITINERARY_NUMBER_CELL)
    .setNumberFormat("@")
    .setBackground("#ffffff")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle")
    .setNote("Enter the HotelPlanner itinerary number. This field is optional.");

  sheet.setRowHeight(10, 28);
}

function setupCallDetailsForSheet_(sheet) {
  const lengthCell = sheet.getRange(CONFIG.CALL_LENGTH_CELL);
  const callDateCell = sheet.getRange(CONFIG.CALL_DATE_CELL);
  const currentLength = String(lengthCell.getDisplayValue() || "").trim();

  // Store call length as text so values such as 32:45 remain exactly 32:45.
  // This avoids Google Sheets interpreting MM:SS as hours and minutes.
  lengthCell.clearDataValidations();
  lengthCell.setNumberFormat("@");

  if (currentLength) {
    lengthCell.setValue(currentLength);
  }

  lengthCell
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("Enter the call length as MM:SS, for example 32:45. Calls over one hour may use H:MM:SS.");

  // Preserve a real date value in F9 and only control how it is displayed.
  callDateCell.clearDataValidations();
  callDateCell
    .setNumberFormat("m/d/yyyy")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("Enter the actual date of the call.");

  makeRangeEditableInsideSheetProtections_(sheet, sheet.getRange("F8:F9"));
}

function normalizeCallLengthCell_(range, editedValue) {
  const text = editedValue === undefined || editedValue === null
    ? String(range.getDisplayValue() || "").trim()
    : String(editedValue).trim();

  range.clearDataValidations();
  range.setNumberFormat("@");

  if (!text) {
    range.clearContent();
    return;
  }

  const cleaned = text.replace(/\s+/g, "");
  const parts = cleaned.split(":");

  // MM:SS or H:MM:SS. We keep it as text so Sheets cannot change its meaning.
  if (parts.length === 2 || parts.length === 3) {
    const numbers = parts.map(part => Number(part));
    const allNumbers = numbers.every(number => Number.isInteger(number) && number >= 0);
    const seconds = numbers[numbers.length - 1];
    const middleValue = parts.length === 3 ? numbers[1] : null;

    if (allNumbers && seconds < 60 && (middleValue === null || middleValue < 60)) {
      const normalized = parts.length === 2
        ? `${numbers[0]}:${String(numbers[1]).padStart(2, "0")}`
        : `${numbers[0]}:${String(numbers[1]).padStart(2, "0")}:${String(numbers[2]).padStart(2, "0")}`;

      range.setValue(normalized);
      return;
    }
  }

  // Never erase an unusual value. Keep exactly what the evaluator entered.
  range.setValue(cleaned);
  range.setNote("Recommended format: MM:SS, for example 32:45. Calls over one hour may use H:MM:SS.");
}

function makeRangeEditableInsideSheetProtections_(sheet, editableRange) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);

  protections.forEach(protection => {
    if (protection.isWarningOnly()) return;

    try {
      const existingRanges = protection.getUnprotectedRanges();
      const targetA1 = editableRange.getA1Notation();
      const alreadyAdded = existingRanges.some(range =>
        range.getSheet().getSheetId() === sheet.getSheetId() &&
        range.getA1Notation() === targetA1
      );

      if (!alreadyAdded) {
        protection.setUnprotectedRanges(existingRanges.concat([editableRange]));
      }
    } catch (error) {
      // A non-owner may not be allowed to change a sheet protection.
      // The repair menu can be run later by Junior or Barbara.
    }
  });
}


// -----------------------------------------------------------------------------
// KELLY-ONLY FORM VALIDATION AND PROTECTION
// -----------------------------------------------------------------------------

function isKellySheet_(sheet) {
  return Boolean(
    sheet &&
    typeof sheet.getName === "function" &&
    sheet.getName() === CONFIG.KELLY_SHEET_NAME
  );
}

function getKellyEmails_() {
  return Array.from(
    new Set(
      (QA_ACCESS_CONFIG.KELLY_EMAILS || [QA_ACCESS_CONFIG.KELLY_EMAIL])
        .map(email => String(email || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function setupKellyFieldRules_(sheet) {
  if (!isKellySheet_(sheet)) return;

  // C5 is fixed to Kelly. It is protected and has no dropdown validation,
  // which prevents Google Sheets from incorrectly marking Kelly as invalid.
  sheet.getRange(CONFIG.EVALUATOR_CELL)
    .clearDataValidations()
    .setNumberFormat("@")
    .setValue("Kelly")
    .setNote("This evaluator is locked to Kelly on the Kelly tab.");

  const callIdCell = sheet.getRange(CONFIG.CALL_ID_CELL);
  const itineraryCell = sheet.getRange(CONFIG.ITINERARY_NUMBER_CELL);

  const callIdRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=OR(C8="",REGEXMATCH(TO_TEXT(C8),"^CA[0-9A-Fa-f]{32}$"))'
    )
    .setAllowInvalid(false)
    .setHelpText(
      "Required format: CA followed by exactly 32 letters/numbers from 0-9 and A-F. Example: CA1579daea5e20c6f8c42d09d1c4158cff"
    )
    .build();

  const itineraryRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=OR(C10="",LEN(TRIM(TO_TEXT(C10)))>=2)'
    )
    .setAllowInvalid(false)
    .setHelpText(
      "Enter any available itinerary, hotel confirmation, supplier confirmation, reservation number, or booking reference."
    )
    .build();

  callIdCell
    .clearDataValidations()
    .setNumberFormat("@")
    .setDataValidation(callIdRule)
    .setBackground("#fff2cc")
    .setNote(
      "KELLY: Double-check the Call ID. It must start with CA and contain exactly 32 hexadecimal characters after CA. Example: CA1579daea5e20c6f8c42d09d1c4158cff"
    );

  sheet.getRange(CONFIG.ITINERARY_NUMBER_LABEL_CELL)
    .setValue("Confirmation / Itinerary #")
    .setFontWeight("bold")
    .setHorizontalAlignment("right")
    .setVerticalAlignment("middle");

  itineraryCell
    .clearDataValidations()
    .setNumberFormat("@")
    .setDataValidation(itineraryRule)
    .setBackground("#fff2cc")
    .setNote(
      "KELLY: Enter any available itinerary, hotel confirmation, supplier confirmation, reservation number, or booking reference. Double-check it before saving."
    );

  sheet.getRange(CONFIG.REVIEW_DATE_CELL)
    .setBackground("#fff2cc")
    .setNote("KELLY: Enter the agent's correct phone start date.");

  sheet.getRange(CONFIG.AGENT_NAME_CELL)
    .setBackground("#fff2cc")
    .setNote("KELLY: Enter the correct agent name.");

  sheet.getRange(CONFIG.CALL_CENTER_CELL)
    .setBackground("#fff2cc")
    .setNote("KELLY: Select the correct call center.");

  sheet.getRange(CONFIG.QA_TYPE_CELL)
    .setBackground("#fff2cc")
    .setNote("KELLY: Select CS or Groups. The criteria will load automatically.");

  sheet.getRange(CONFIG.CALL_LENGTH_CELL)
    .setBackground("#fff2cc")
    .setNote("KELLY: Enter the correct call length, such as 32:45.");

  sheet.getRange(CONFIG.CALL_DATE_CELL)
    .setBackground("#fff2cc")
    .setNote("KELLY: Enter the actual date of the call.");

  sheet.getRange("E12:E20")
    .setBackground("#fff2cc")
    .setNote("KELLY: Select the correct status for every visible criterion.");

  // Do not write cell notes into I12:I20 here. Those notes store Kelly's
  // complete custom-note text and must never be overwritten by setup.
  sheet.getRange("I12:I20")
    .setBackground("#fff7ed");

  sheet.getRange(CONFIG.CUSTOM_NOTES_HEADER_CELL)
    .setNote(
      "KELLY: Add a clear explanation in column I whenever you select Markdown or Partial."
    );

  sheet.getRange(CONFIG.SAVE_BUTTON_CELL)
    .setNote(
      "KELLY: Before saving, confirm the Call ID, itinerary, call date, call length, and every criterion status."
    );
}

function protectKellyTab_(sheet) {
  if (!isKellySheet_(sheet)) return;

  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  let protection = protections.find(item =>
    item.getDescription() === CONFIG.KELLY_PROTECTION_DESCRIPTION
  );

  if (!protection) {
    protection = sheet.protect().setDescription(
      CONFIG.KELLY_PROTECTION_DESCRIPTION
    );
  }

  protection.setWarningOnly(false);

  const managerEmails = getQaManagerEmails_();
  managerEmails.forEach(email => {
    try {
      protection.addEditor(email);
    } catch (error) {
      // The manager may already be an editor or may use inherited access.
    }
  });

  try {
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
  } catch (error) {
    // Consumer-owned spreadsheets may not expose domain controls.
  }

  const allowedEditors = new Set(managerEmails);
  const effectiveUser = getAuthorizedUserEmail_();
  if (effectiveUser) allowedEditors.add(effectiveUser);

  const editorsToRemove = protection.getEditors().filter(user => {
    const email = String(user.getEmail() || "").trim().toLowerCase();
    return email && !allowedEditors.has(email);
  });

  if (editorsToRemove.length) {
    try {
      protection.removeEditors(editorsToRemove);
    } catch (error) {
      editorsToRemove.forEach(user => {
        try {
          protection.removeEditor(user);
        } catch (ignored) {
          // Ignore inherited group permissions.
        }
      });
    }
  }

  getKellyEmails_().forEach(email => {
    try {
      protection.removeEditor(email);
    } catch (error) {
      // Kelly does not need to be a protection editor. She uses unprotected cells.
    }
  });

  const allowedRanges = CONFIG.KELLY_ALLOWED_EDIT_RANGES.map(a1 =>
    sheet.getRange(a1)
  );
  protection.setUnprotectedRanges(allowedRanges);
}

function setupKellyTabSecurity() {
  assertQaManager_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.KELLY_SHEET_NAME);

  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      `The "${CONFIG.KELLY_SHEET_NAME}" tab was not found. No data was changed.`
    );
    return;
  }

  showLoading_("Applying Kelly-only validation and protection...");

  // These operations only change Kelly's validation, notes, colors, and
  // protection settings. No review rows or saved data are cleared or moved.
  setEvaluatorForSheet_(sheet, "Kelly");
  setupKellyFieldRules_(sheet);
  protectKellyTab_(sheet);
  installOwnerEditTrigger_(false);

  SpreadsheetApp.flush();
  showDone_("Kelly's tab is protected and validated.");

  SpreadsheetApp.getUi().alert(
    "Kelly's tab is now locked. Kelly can edit only C3, C6:C10, F8:F9, E12:E20, I12:I20, and G22. C8 keeps its strict Call ID format, while C10 accepts any confirmation or booking reference, and the owner trigger was repaired. No saved data was deleted or moved."
  );
}

function normalizeKellyCallId_(value) {
  const cleaned = String(value || "").replace(/\s+/g, "").trim();
  if (!cleaned) return "";

  if (/^ca/i.test(cleaned)) {
    return "CA" + cleaned.substring(2);
  }

  return cleaned;
}

function normalizeKellyItinerary_(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidKellyCallId_(value) {
  return /^CA[0-9A-Fa-f]{32}$/.test(String(value || "").trim());
}

function isValidKellyItinerary_(value) {
  return String(value || "").trim().length >= 2;
}

function setKellyTodayDate_(sheet) {
  if (!isKellySheet_(sheet)) return;

  const todayCell = sheet.getRange(CONFIG.TODAY_DATE_CELL);
  const current = todayCell.getValue();
  const now = new Date();

  const currentDate = current instanceof Date && !isNaN(current.getTime())
    ? new Date(current.getTime())
    : null;

  if (currentDate) currentDate.setHours(0, 0, 0, 0);
  const todayOnly = new Date(now.getTime());
  todayOnly.setHours(0, 0, 0, 0);

  if (!currentDate || currentDate.getTime() !== todayOnly.getTime()) {
    todayCell.clearDataValidations();
    todayCell.setValue(now).setNumberFormat("m/d/yyyy");
    setTodayDateValidation_(sheet);
  }
}

function handleKellyProtectedEdit_(e) {
  const sheet = e.range.getSheet();
  const cell = e.range.getA1Notation();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!isKellySheet_(sheet)) return false;

  setKellyTodayDate_(sheet);

  if (cell === CONFIG.CALL_ID_CELL) {
    const normalized = normalizeKellyCallId_(e.value);
    e.range.setNumberFormat("@").setValue(normalized);

    if (!normalized) {
      e.range.setBackground("#fff2cc");
      ss.toast(
        "Kelly: Call ID is required. Use CA followed by exactly 32 hexadecimal characters.",
        "Check Your Work",
        8
      );
      return true;
    }

    if (!isValidKellyCallId_(normalized)) {
      e.range.setBackground("#f4cccc");
      ss.toast(
        "Kelly: The Call ID is not correct. Example: CA1579daea5e20c6f8c42d09d1c4158cff",
        "Fix Call ID",
        10
      );
      return true;
    }

    e.range.setBackground("#d9ead3");
    ss.toast(
      `Kelly: Please confirm this is the correct Call ID: ${normalized}`,
      "Double-Check",
      7
    );
    return true;
  }

  if (cell === CONFIG.ITINERARY_NUMBER_CELL) {
    const normalized = normalizeKellyItinerary_(e.value);
    e.range.setNumberFormat("@").setValue(normalized);

    if (!normalized) {
      e.range.setBackground("#fff2cc");
      ss.toast(
        "Kelly: Add an itinerary, confirmation number, reservation number, or booking reference.",
        "Check Your Work",
        8
      );
      return true;
    }

    if (!isValidKellyItinerary_(normalized)) {
      e.range.setBackground("#f4cccc");
      ss.toast(
        "Kelly: The confirmation or itinerary number must contain at least 2 characters.",
        "Fix Confirmation",
        10
      );
      return true;
    }

    e.range.setBackground("#d9ead3");
    ss.toast(
      `Kelly: Please confirm this booking reference is correct: ${normalized}`,
      "Double-Check",
      7
    );
    return true;
  }

  if (cell === CONFIG.QA_TYPE_CELL) {
    const qaType = normalizeQaType_(e.range.getValue());
    e.range.setValue(qaType);
    applyCriteriaByQaType_(sheet, qaType);
    forceCriteriaDropdownsForSheet_(sheet);
    setupKellyFieldRules_(sheet);
    protectKellyTab_(sheet);

    ss.toast(
      `Kelly: ${qaType || "No"} criteria loaded. Check every row carefully.`,
      "Double-Check",
      8
    );
    return true;
  }

  if (
    e.range.getColumn() === CONFIG.STATUS_COL &&
    e.range.getRow() >= CONFIG.CRITERIA_START_ROW &&
    e.range.getRow() <= CONFIG.CRITERIA_END_ROW
  ) {
    const row = e.range.getRow();
    const status = String(e.range.getValue() || "").trim();

    if (/markdown|partial/i.test(status)) {
      ss.toast(
        `Kelly: You selected ${status} on row ${row}. Add a clear explanation in I${row}.`,
        "Note Required",
        9
      );
    } else {
      ss.toast(
        `Kelly: Please confirm the selection on criterion row ${row} is correct.`,
        "Double-Check",
        6
      );
    }
    return false;
  }

  if (
    e.range.getColumn() === CONFIG.CUSTOM_NOTES_COL &&
    e.range.getRow() >= CONFIG.CUSTOM_NOTES_START_ROW &&
    e.range.getRow() <= CONFIG.CUSTOM_NOTES_END_ROW
  ) {
    ss.toast(
      `Kelly: Confirm the note in I${e.range.getRow()} clearly explains the issue.`,
      "Double-Check",
      6
    );
    return false;
  }

  if (
    [CONFIG.REVIEW_DATE_CELL, CONFIG.AGENT_NAME_CELL, CONFIG.CALL_CENTER_CELL,
      CONFIG.CALL_LENGTH_CELL, CONFIG.CALL_DATE_CELL].includes(cell)
  ) {
    ss.toast(
      `Kelly: Please confirm the value entered in ${cell} is correct.`,
      "Double-Check",
      5
    );
    return false;
  }

  return false;
}

function fixCallDetailsAllQaTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    assertQaManager_();
  } catch (error) {
    SpreadsheetApp.getUi().alert(error.message);
    return;
  }

  showLoading_("Fixing Length of Call and Date of Call on all QA tabs...");

  const sheetNames = [CONFIG.TEMPLATE_SHEET_NAME].concat(
    getAllQaUserConfigs_().map(item => item.sheetName)
  );

  Array.from(new Set(sheetNames)).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) setupCallDetailsForSheet_(sheet);
  });

  const destinationSheet = getOrCreateDestinationSheet_(ss);
  ensureCallDetailColumns_(destinationSheet);

  SpreadsheetApp.flush();
  showDone_("Call details were fixed on every QA tab.");
  SpreadsheetApp.getUi().alert(
    'F8 is now an editable call-length field, F9 is the call date, and both fields will save into new columns appended to the far right of "Agents Reviewed". Existing review data was not moved or deleted.'
  );
}

function showLoading_(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(
    message,
    "QA Tracker - Loading",
    30
  );
  SpreadsheetApp.flush();
}

function showDone_(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(
    message,
    "QA Tracker",
    4
  );
  SpreadsheetApp.flush();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("QA Tracker")
    .addItem("Setup Junior, Barbara & Kelly Tabs SAFE", "setupFullQaTracker")
    .addItem("Setup Current QA Tab", "setupCurrentQaTab")
    .addItem("Setup Save Button - Current Tab", "setupSaveButton")
    .addItem("Setup / Convert Custom Notes - Current Tab", "setupCustomNotes")
    .addItem("Force Criteria Dropdowns - Current Tab", "forceCriteriaDropdowns")
    .addItem("Fix Evaluator Dropdowns", "fixEvaluatorDropdowns")
    .addItem("FORCE Repair Evaluator C5 - All Tabs", "forceRepairEvaluatorDropdowns")
    .addSeparator()
    .addItem("Add QA Person / Create Tab", "addQaPerson")
    .addSeparator()
    .addItem("Fix Call Center Dropdown - Current Tab", "fixCallCenterDropdown")
    .addItem("Fix Date Rules C3/C4 - Current Tab", "fixDateRules")
    .addItem("Fix Call Details F8/F9 - All QA Tabs", "fixCallDetailsAllQaTabs")
    .addItem("Repair Agents Reviewed Tab - Keep Data", "setupAgentsReviewedTab")
    .addItem("Install / Repair Owner Save Trigger", "installOwnerEditTrigger")
    .addItem("Apply / Repair Kelly Lock", "setupKellyTabSecurity")
    .addSeparator()
    .addItem("Load CS Criteria - Current Tab", "loadCsCriteria")
    .addItem("Load Groups Criteria - Current Tab", "loadGroupsCriteria")
    .addSeparator()
    .addItem("Save Review Now", "saveReview")
    .addToUi();
}

function onSelectionChange(e) {
  if (!e) return;

  const sheet = e.range.getSheet();
  const cell = e.range.getA1Notation();

  if (!isQaFormSheet_(sheet)) return;

  if (cell === CONFIG.TODAY_DATE_CELL) {
    if (isKellySheet_(sheet)) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "Kelly: Today's Date is filled automatically and cannot be changed.",
        "Protected Field",
        5
      );
      return;
    }

    setTodayDate_(sheet);
  }
}

function onEdit(e) {
  if (!e) return;

  const sheet = e.range.getSheet();
  const cell = e.range.getA1Notation();

  if (!isQaFormSheet_(sheet)) return;

  if (isCustomNoteCell_(e.range)) {
    handleCustomNoteEdit_(e.range, e.value);
    return;
  }

  if (cell === CONFIG.EVALUATOR_CELL) {
    const selectedEvaluator = String(e.range.getValue() || "").trim();

    if (!getEvaluatorOptions_().includes(selectedEvaluator)) {
      setEvaluatorForSheet_(sheet, getConfiguredEvaluatorForSheet_(sheet));
    }
    return;
  }

  if (cell === CONFIG.REVIEW_DATE_CELL) {
    // Google Sheets already stores the typed date correctly. Do not rewrite
    // the Date object here because that can move it back one day by timezone.
    e.range.setNumberFormat("m/d/yyyy");
    setReviewDateValidation_(sheet);
    return;
  }

  if (cell === CONFIG.TODAY_DATE_CELL) {
    setTodayDate_(sheet);
    return;
  }

  if (cell === CONFIG.CALL_LENGTH_CELL) {
    normalizeCallLengthCell_(e.range, e.value);
    return;
  }

  if (cell === CONFIG.CALL_DATE_CELL) {
    e.range.clearDataValidations();
    e.range.setNumberFormat("m/d/yyyy");
    return;
  }

  if (cell === CONFIG.CALL_CENTER_CELL) {
    const normalizedCallCenter = normalizeCallCenter_(e.range.getValue());
    e.range.setValue(normalizedCallCenter);
    return;
  }

  if (cell === CONFIG.QA_TYPE_CELL) {
    // Kelly's criteria area is protected. The owner-installed trigger performs
    // the protected writes for her. Junior and Barbara keep the original flow.
    if (isKellySheet_(sheet)) return;

    const qaType = normalizeQaType_(e.range.getValue());
    e.range.setValue(qaType);
    applyCriteriaByQaType_(sheet, qaType);
    forceCriteriaDropdownsForSheet_(sheet);
    return;
  }

}

function qaOwnerOnEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const cell = e.range.getA1Notation();

  if (
    sheetName === CONFIG.DESTINATION_SHEET_NAME &&
    e.range.getRow() >= 2 &&
    e.range.getColumn() === CONFIG.EMAIL_SENT_COLUMN &&
    e.range.getNumRows() === 1 &&
    e.range.getNumColumns() === 1
  ) {
    handleEmailSentCheckboxEdit_(e);
    return;
  }

  if (isKellySheet_(sheet) && cell !== CONFIG.SAVE_BUTTON_CELL) {
    handleKellyProtectedEdit_(e);
  }

  if (
    isQaFormSheet_(sheet) &&
    cell === CONFIG.SAVE_BUTTON_CELL &&
    String(e.value || "").toUpperCase() === "TRUE"
  ) {
    saveReviewForSheet_(sheet);
    resetSaveCheckbox_(sheet);
    sheet.getRange(CONFIG.SAVE_BUTTON_CELL).activate();
  }
}

function installOwnerEditTrigger() {
  assertQaManager_();
  installOwnerEditTrigger_(true);
}

function installOwnerEditTrigger_(showAlert) {
  const handler = CONFIG.OWNER_EDIT_TRIGGER_HANDLER;
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(handler)
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  if (showAlert) {
    SpreadsheetApp.getUi().alert(
      "Owner edit trigger installed. Kelly can load protected criteria, receive validation warnings, and save from G22 while protected tabs stay locked."
    );
  }
}

function getQaManagerEmails_() {
  return [QA_ACCESS_CONFIG.JUNIOR_EMAIL]
    .concat(QA_ACCESS_CONFIG.BARBARA_EMAILS)
    .map(email => String(email || "").trim().toLowerCase())
    .filter(Boolean);
}

function addQaManagerSpreadsheetEditors_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  getQaManagerEmails_().forEach(email => {
    try {
      ss.addEditor(email);
    } catch (error) {
      console.error(`Could not add ${email} as a spreadsheet editor: ${error.message}`);
    }
  });
}

function getAuthorizedUserEmail_() {
  const effective = String(Session.getEffectiveUser().getEmail() || "")
    .trim()
    .toLowerCase();

  if (effective) return effective;

  return String(Session.getActiveUser().getEmail() || "")
    .trim()
    .toLowerCase();
}

function isQaManagerEmail_(email) {
  return getQaManagerEmails_().includes(String(email || "").trim().toLowerCase());
}

function assertQaManager_() {
  const email = getAuthorizedUserEmail_();

  if (!isQaManagerEmail_(email)) {
    throw new Error(
      "Only Junior or Barbara can repair the protected review tabs or install the owner trigger."
    );
  }
}

function getEditActorEmail_(e) {
  try {
    if (e && e.user && typeof e.user.getEmail === "function") {
      const eventEmail = String(e.user.getEmail() || "").trim().toLowerCase();
      if (eventEmail) return eventEmail;
    }
  } catch (error) {
    // Some account combinations do not expose the editor email in edit events.
  }

  return "authorized editor (email unavailable)";
}

function setupFullQaTracker() {
  showLoading_("Creating and setting up Junior, Barbara, and Kelly QA tabs. Please wait...");

  try {
    assertQaManager_();
    addQaManagerSpreadsheetEditors_();
    setupAllQaUserTabs_();
    setupAgentsReviewedTab(false);
    fixEvaluatorDropdowns(false);
    installOwnerEditTrigger_(false);

    showDone_("Multi-user QA Tracker setup is complete.");

    SpreadsheetApp.getUi().alert(
      'Setup complete. Barbara.Kalchik@HotelPlanner.com was added as a spreadsheet editor. Existing saved reviews were kept. Column H is now "Email Sent?", QA Type moved to Column I, the email audit tab was created, and Kelly can save through G22 without being able to edit "Agents Reviewed".'
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Setup failed:

${error.message}`);
  }
}

function setupCurrentQaTab() {
  const sheet = getActiveQaSheet_();
  if (!sheet) return;

  showLoading_(`Setting up "${sheet.getName()}". Please wait...`);
  setupQaSheet_(sheet, getConfiguredEvaluatorForSheet_(sheet));
  showDone_(`"${sheet.getName()}" is ready.`);
}

function fixDateRules() {
  const sheet = getActiveQaSheet_();
  if (!sheet) return;

  showLoading_("Fixing C3/C4 date rules. Please wait...");
  forceFixDateCellsNow_(sheet);
  showDone_("Date rules fixed.");

  SpreadsheetApp.getUi().alert(
    "Date rules fixed. C3 accepts dates from the last 6 years or any date in 2026. C4 has been set to today's date."
  );
}

function setupDateRules_(sheet) {
  forceFixDateCellsNow_(sheet);
}

function forceFixDateCellsNow_(sheet) {
  const c3 = sheet.getRange(CONFIG.REVIEW_DATE_CELL);
  const c4 = sheet.getRange(CONFIG.TODAY_DATE_CELL);

  c3.clearDataValidations();
  c4.clearDataValidations();

  SpreadsheetApp.flush();

  const c3Value = c3.getValue();
  const c3IsValidDate =
    Object.prototype.toString.call(c3Value) === "[object Date]" &&
    !isNaN(c3Value.getTime());

  // Preserve valid Sheet date values exactly as entered. Only convert C3 when
  // it is stored as text, which avoids the 6/9/2026 -> 6/8/2026 timezone shift.
  if (c3Value && !c3IsValidDate) {
    const convertedC3 = forceDateObject_(c3Value);

    if (convertedC3) {
      c3.setValue(convertedC3);
    }
  }

  // Keep the current time instead of forcing midnight. Midnight is the point
  // most likely to cross into the previous day in a different timezone.
  c4.setValue(new Date());

  c3.setNumberFormat("m/d/yyyy");
  c4.setNumberFormat("m/d/yyyy");

  SpreadsheetApp.flush();

  setReviewDateValidation_(sheet);
  setTodayDateValidation_(sheet);
}

function setReviewDateValidation_(sheet) {
  const reviewDateCell = sheet.getRange(CONFIG.REVIEW_DATE_CELL);

  const reviewDateRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=OR(C3="",AND(ISNUMBER(C3),OR(AND(C3>=EDATE(TODAY(),-72),C3<=TODAY()),AND(C3>=DATE(2026,1,1),C3<=DATE(2026,12,31)))))'
    )
    .setAllowInvalid(false)
    .setHelpText("Start Date must be within the last 6 years or any date in 2026.")
    .build();

  reviewDateCell.clearDataValidations();
  reviewDateCell.setNumberFormat("m/d/yyyy");
  reviewDateCell.setDataValidation(reviewDateRule);
}

function setTodayDateValidation_(sheet) {
  const todayDateCell = sheet.getRange(CONFIG.TODAY_DATE_CELL);

  const todayDateRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(C4="",AND(ISNUMBER(C4),INT(C4)=TODAY()))')
    .setAllowInvalid(false)
    .setHelpText("Today's Date must be today's actual date.")
    .build();

  todayDateCell.clearDataValidations();
  todayDateCell.setNumberFormat("m/d/yyyy");
  todayDateCell.setDataValidation(todayDateRule);
}

function setTodayDate_(sheet) {
  const todayDateCell = sheet.getRange(CONFIG.TODAY_DATE_CELL);

  todayDateCell.clearDataValidations();

  // Keep the current time so the date does not cross backward at midnight
  // when the Apps Script and spreadsheet timezones are different.
  todayDateCell.setValue(new Date());
  todayDateCell.setNumberFormat("m/d/yyyy");

  SpreadsheetApp.flush();

  setTodayDateValidation_(sheet);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Today's date added to C4.",
    "QA Tracker",
    2
  );
}

function forceDateObject_(value) {
  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    // Return a copy without changing its hour or calendar day.
    return new Date(value.getTime());
  }

  const text = String(value || "").trim();
  if (!text) return null;

  const parts = text.split("/");

  if (parts.length === 3) {
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    let year = Number(parts[2]);

    if (year >= 0 && year < 100) {
      year += 2000;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900) {
      // Noon is used only when converting text into a Date object. It is much
      // safer than midnight when script and spreadsheet timezones differ.
      return new Date(year, month - 1, day, 12, 0, 0, 0);
    }
  }

  const parsed = new Date(text);

  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function setupSaveButton(showAlert = true) {
  const sheet = getActiveQaSheet_(showAlert);
  if (!sheet) return;

  if (showAlert) {
    showLoading_("Setting up the Save Review button. Please wait...");
  }

  setupSaveButtonForSheet_(sheet);

  if (showAlert) {
    showDone_("Save Review button is ready.");
  }
}

function setupSaveButtonForSheet_(sheet) {
  CONFIG.OLD_BUTTON_CELLS_TO_CLEAR.forEach(a1 => {
    sheet.getRange(a1)
      .clearContent()
      .clearDataValidations()
      .clearNote()
      .setBackground(null)
      .setFontColor(null)
      .setFontWeight(null);
  });

  sheet.getRange("G21:G22")
    .clearContent()
    .clearDataValidations()
    .clearNote()
    .setBackground(null)
    .setFontColor(null)
    .setFontWeight(null);

  sheet.getRange(CONFIG.SAVE_BUTTON_LABEL_CELL)
    .setValue("Save Review")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1f4e78")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("When finished reviewing, click the checkbox below in G22.");

  const checkbox = sheet.getRange(CONFIG.SAVE_BUTTON_CELL);
  checkbox.clearContent();
  checkbox.clearDataValidations();
  checkbox.clearNote();
  checkbox.insertCheckboxes();
  checkbox.setValue(false);

  checkbox
    .setBackground("#d9ead3")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote('Click this checkbox to save the review into "Agents Reviewed".');

  sheet.setColumnWidth(7, 120);
  sheet.setRowHeight(21, 25);
  sheet.setRowHeight(22, 35);
  checkbox.activate();
}

function setSaveUiState_(sheet, isSaving) {
  const labelCell = sheet.getRange(CONFIG.SAVE_BUTTON_LABEL_CELL);

  if (isSaving) {
    labelCell
      .setValue("Saving...")
      .setFontWeight("bold")
      .setFontColor("#000000")
      .setBackground("#facc15")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");

    SpreadsheetApp.flush();
    return;
  }

  labelCell
    .setValue("Save Review")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1f4e78")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  SpreadsheetApp.flush();
}

function setupCustomNotes(showAlert = true) {
  const sheet = getActiveQaSheet_(showAlert);
  if (!sheet) return;

  if (showAlert) {
    showLoading_("Setting up Custom Notes. Please wait...");
  }

  setupCustomNotesForSheet_(sheet);

  if (showAlert) {
    showDone_("Custom Notes are ready.");
  }
}

function setupCustomNotesForSheet_(sheet) {
  sheet.getRange(CONFIG.CUSTOM_NOTES_HEADER_CELL)
    .setValue("Custom Notes")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#374151")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("Type notes below. The cell shows a short preview, and the full note appears when hovering.");

  const notesRange = sheet.getRange(CONFIG.CUSTOM_NOTES_RANGE);

  notesRange
    .setBackground("#fff7ed")
    .setFontSize(9)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(false);

  sheet.setColumnWidth(9, 120);

  for (let row = CONFIG.CUSTOM_NOTES_START_ROW; row <= CONFIG.CUSTOM_NOTES_END_ROW; row++) {
    sheet.setRowHeight(row, 50);
  }

  convertExistingCustomNotes_(sheet);
}

function setupDropdownsAndFormulas_(sheet) {
  const configuredEvaluator = getConfiguredEvaluatorForSheet_(sheet);

  const evaluatorRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(getEvaluatorOptions_(), true)
    .setAllowInvalid(false)
    .setHelpText("Select a configured QA evaluator.")
    .build();

  const qaTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(QA_TYPE_OPTIONS, true)
    .setAllowInvalid(true)
    .build();

  const callCenterRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CALL_CENTER_OPTIONS, true)
    .setAllowInvalid(true)
    .build();

  sheet.getRange(CONFIG.EVALUATOR_CELL).clearDataValidations();
  sheet.getRange(CONFIG.QA_TYPE_CELL).clearDataValidations();
  sheet.getRange(CONFIG.CALL_CENTER_CELL).clearDataValidations();

  SpreadsheetApp.flush();

  const currentCallCenter = normalizeCallCenter_(sheet.getRange(CONFIG.CALL_CENTER_CELL).getValue());
  const currentQaType = normalizeQaType_(sheet.getRange(CONFIG.QA_TYPE_CELL).getValue());

  if (currentCallCenter) {
    sheet.getRange(CONFIG.CALL_CENTER_CELL).setValue(currentCallCenter);
  }

  if (currentQaType) {
    sheet.getRange(CONFIG.QA_TYPE_CELL).setValue(currentQaType);
  }

  const currentEvaluator = String(
    sheet.getRange(CONFIG.EVALUATOR_CELL).getValue() || ""
  ).trim();

  if (!getEvaluatorOptions_().includes(currentEvaluator)) {
    sheet.getRange(CONFIG.EVALUATOR_CELL).setValue(
      getEvaluatorOptions_().includes(configuredEvaluator)
        ? configuredEvaluator
        : getEvaluatorOptions_()[0]
    );
  }

  SpreadsheetApp.flush();

  sheet.getRange(CONFIG.EVALUATOR_CELL).setDataValidation(evaluatorRule);
  sheet.getRange(CONFIG.QA_TYPE_CELL).setDataValidation(qaTypeRule);
  sheet.getRange(CONFIG.CALL_CENTER_CELL).setDataValidation(callCenterRule);

  setupItineraryField_(sheet);
  setupDateRules_(sheet);
  forceCriteriaDropdownsForSheet_(sheet);

  sheet.getRange(CONFIG.FINAL_SCORE_CELL).setFormula("=SUM(G12:G20)");
  sheet.getRange(CONFIG.KPI_TARGET_CELL).setFormula('=IF(LOWER(C9)="groups",85,IF(LOWER(C9)="cs",90,""))');
  sheet.getRange(CONFIG.RESULT_CELL).setFormula('=IF(F4>=F5,"PASS","FAIL")');
  sheet.getRange(CONFIG.MARKDOWNS_CELL).setFormula('=COUNTIF(E12:E20,"✕ Markdown")');

  forceCriteriaFormulasForSheet_(sheet);

  sheet.getRange("D12:D20").setNumberFormat("0");
  sheet.getRange("F12:G20").setNumberFormat("0");
  sheet.getRange("F4:F7").setNumberFormat("0");
}

function forceRepairEvaluatorDropdowns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const evaluatorOptions = getEvaluatorOptions_();
  const evaluatorRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(evaluatorOptions, true)
    .setAllowInvalid(false)
    .setHelpText("Select a configured QA evaluator.")
    .build();

  const sheetNames = [CONFIG.TEMPLATE_SHEET_NAME].concat(
    getAllQaUserConfigs_().map(item => item.sheetName)
  );

  Array.from(new Set(sheetNames)).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const cell = sheet.getRange(CONFIG.EVALUATOR_CELL);
    const current = String(cell.getDisplayValue() || "")
      .replace(/\u00A0/g, " ")
      .trim();

    cell.clearDataValidations();
    cell.clearContent();

    let safeValue = current;
    if (!evaluatorOptions.includes(safeValue)) {
      const configured = getConfiguredEvaluatorForSheet_(sheet);
      safeValue = evaluatorOptions.includes(configured)
        ? configured
        : evaluatorOptions[0];
    }

    if (isKellySheet_(sheet)) {
      cell.clearDataValidations();
      cell.setValue("Kelly");
      cell.setNumberFormat("@");
      cell.setNote("This evaluator is locked to Kelly on the Kelly tab.");
    } else {
      cell.setValue(safeValue);
      cell.setDataValidation(evaluatorRule);
      cell.setNumberFormat("@");
    }
  });

  const reviewedSheet = ss.getSheetByName(CONFIG.DESTINATION_SHEET_NAME);
  if (reviewedSheet) {
    reviewedSheet.getRange("D2:D10000")
      .clearDataValidations()
      .setDataValidation(evaluatorRule);
  }

  SpreadsheetApp.flush();
  ss.toast(
    "Evaluator dropdowns were repaired on every configured QA tab.",
    "QA Tracker",
    5
  );
  SpreadsheetApp.getUi().alert(
    `Evaluator C5 repaired. Available names: ${evaluatorOptions.join(", ")}.`
  );
}

function fixEvaluatorDropdowns(showAlert = true) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (showAlert) {
    showLoading_("Fixing Evaluator dropdowns. Please wait...");
  }

  getAllQaUserConfigs_().forEach(userConfig => {
    const sheet = ss.getSheetByName(userConfig.sheetName);
    if (sheet) setEvaluatorForSheet_(sheet, userConfig.evaluator);
  });

  const templateSheet = ss.getSheetByName(CONFIG.TEMPLATE_SHEET_NAME);
  if (templateSheet) setEvaluatorForSheet_(templateSheet, "");

  const reviewedSheet = ss.getSheetByName(CONFIG.DESTINATION_SHEET_NAME);

  if (reviewedSheet) {
    const evaluatorRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(getEvaluatorOptions_(), true)
      .setAllowInvalid(false)
      .build();

    reviewedSheet.getRange("D2:D10000")
      .clearDataValidations()
      .setDataValidation(evaluatorRule);
  }

  if (showAlert) {
    showDone_("Evaluator dropdowns fixed.");
    SpreadsheetApp.getUi().alert(
      `Evaluator dropdowns fixed for: ${getEvaluatorOptions_().join(", ")}.`
    );
  }
}

function fixCallCenterDropdown(showAlert = true) {
  const sheet = getActiveQaSheet_(showAlert);
  if (!sheet) return;

  if (showAlert) {
    showLoading_("Fixing Call Center dropdown. Please wait...");
  }

  fixCallCenterDropdownForSheet_(sheet);

  if (showAlert) {
    showDone_("Call Center dropdown fixed.");
    SpreadsheetApp.getUi().alert(
      "Call Center dropdown fixed. Allowed values: WNS, Concentrix, Buwelo-G, Buwelo-C, Telus."
    );
  }
}

function fixCallCenterDropdownForSheet_(sheet) {
  const callCenterRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CALL_CENTER_OPTIONS, true)
    .setAllowInvalid(true)
    .build();

  const callCenterCell = sheet.getRange(CONFIG.CALL_CENTER_CELL);
  callCenterCell.clearDataValidations();
  SpreadsheetApp.flush();

  const normalized = normalizeCallCenter_(callCenterCell.getValue());

  if (normalized) {
    callCenterCell.setValue(normalized);
  }

  SpreadsheetApp.flush();
  callCenterCell.setDataValidation(callCenterRule);
}

function forceCriteriaDropdowns() {
  const sheet = getActiveQaSheet_();
  if (!sheet) return;

  showLoading_("Forcing criteria dropdowns. Please wait...");
  forceCriteriaDropdownsForSheet_(sheet);
  forceCriteriaFormulasForSheet_(sheet);
  showDone_("Criteria dropdowns were forced.");
  SpreadsheetApp.getUi().alert("Dropdowns were forced on E12:E20.");
}

function forceCriteriaDropdownsForSheet_(sheet) {
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .build();

  sheet
    .getRange(
      CONFIG.CRITERIA_START_ROW,
      CONFIG.STATUS_COL,
      CONFIG.CRITERIA_END_ROW - CONFIG.CRITERIA_START_ROW + 1,
      1
    )
    .setDataValidation(statusRule)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

function forceCriteriaFormulasForSheet_(sheet) {
  for (let row = CONFIG.CRITERIA_START_ROW; row <= CONFIG.CRITERIA_END_ROW; row++) {
    sheet.getRange(row, CONFIG.AUTO_POINTS_COL).setFormula(
      `=IF(E${row}="","",IF(OR(E${row}="✓ Followed",E${row}="N/A"),D${row},IF(E${row}="✕ Markdown",0,IF(E${row}="Partial",D${row}/2,0))))`
    );
  }
}

function loadCsCriteria() {
  const sheet = getActiveQaSheet_();
  if (!sheet) return;

  showLoading_("Loading CS criteria. Please wait...");
  sheet.getRange(CONFIG.QA_TYPE_CELL).setValue("CS");
  applyCriteriaByQaType_(sheet, "CS");
  showDone_("CS criteria loaded.");
}

function loadGroupsCriteria() {
  const sheet = getActiveQaSheet_();
  if (!sheet) return;

  showLoading_("Loading Groups criteria. Please wait...");
  sheet.getRange(CONFIG.QA_TYPE_CELL).setValue("Groups");
  applyCriteriaByQaType_(sheet, "Groups");
  showDone_("Groups criteria loaded.");
}

function applyCriteriaByQaType_(sheet, qaType) {
  const normalized = String(qaType || "").trim().toLowerCase();

  if (normalized === "groups") {
    loadCriteriaIntoSheet_(sheet, GROUPS_CRITERIA);
    setupDropdownsAndFormulas_(sheet);
    SpreadsheetApp.getActiveSpreadsheet().toast("Groups criteria loaded. KPI target is 85.", "QA Tracker", 4);
    return;
  }

  if (normalized === "cs") {
    loadCriteriaIntoSheet_(sheet, CS_CRITERIA);
    setupDropdownsAndFormulas_(sheet);
    SpreadsheetApp.getActiveSpreadsheet().toast("CS criteria loaded. KPI target is 90.", "QA Tracker", 4);
    return;
  }
}

function loadCriteriaIntoSheet_(sheet, criteria) {
  const rowCount = CONFIG.CRITERIA_END_ROW - CONFIG.CRITERIA_START_ROW + 1;
  const values = [];

  for (let i = 0; i < rowCount; i++) {
    const item = criteria[i];

    if (item) {
      values.push([
        item.number,
        item.name,
        item.points,
        "",
        "",
        "",
        item.notes
      ]);
    } else {
      values.push(["", "", "", "", "", "", ""]);
    }
  }

  sheet
    .getRange(CONFIG.CRITERIA_START_ROW, CONFIG.CRITERIA_NUMBER_COL, rowCount, 7)
    .setValues(values);

  sheet.getRange("E12:F20").clearContent();

  setupDropdownsAndFormulas_(sheet);
  forceCriteriaDropdownsForSheet_(sheet);
  forceCriteriaFormulasForSheet_(sheet);
  applyCriteriaFormatting_(sheet);
}

function applyCriteriaFormatting_(sheet) {
  sheet.getRange("B11:H11")
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1f2937")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  sheet.getRange("B12:H20")
    .setWrap(true)
    .setVerticalAlignment("middle");

  sheet.getRange("E12:E20").setHorizontalAlignment("center");
  sheet.getRange("D12:D20").setHorizontalAlignment("center");
  sheet.getRange("F12:G20").setHorizontalAlignment("center");

  sheet.setColumnWidth(2, 60);
  sheet.setColumnWidth(3, 260);
  sheet.setColumnWidth(4, 70);
  sheet.setColumnWidth(5, 130);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 420);
  sheet.setColumnWidth(9, 120);

  for (let r = 12; r <= 22; r++) {
    sheet.setRowHeight(r, 50);
  }
}

function setupAgentsReviewedTab(showAlert = true) {
  assertQaManager_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (showAlert) {
    showLoading_("Repairing Agents Reviewed and email audit tabs. Please wait...");
  }

  const destinationSheet = getOrCreateDestinationSheet_(ss);
  ensureEmailSentColumn_(destinationSheet);

  const headers = buildHeaders_();
  const existingFilter = destinationSheet.getFilter();

  if (existingFilter) {
    existingFilter.remove();
  }

  destinationSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatDestinationSheet_(destinationSheet, headers.length);
  ensureCallDetailColumns_(destinationSheet);
  setupEmailSentCheckboxes_(destinationSheet);
  setupEmailSentDetailsTab_(ss);
  protectQaManagerSheet_(
    destinationSheet,
    QA_ACCESS_CONFIG.RESULTS_PROTECTION_DESCRIPTION
  );
  protectQaManagerSheet_(
    ss.getSheetByName(CONFIG.EMAIL_DETAILS_SHEET_NAME),
    QA_ACCESS_CONFIG.EMAIL_LOG_PROTECTION_DESCRIPTION
  );
  fixEvaluatorDropdowns(false);

  if (showAlert) {
    showDone_("Agents Reviewed tab repaired.");

    SpreadsheetApp.getUi().alert(
      `The "${CONFIG.DESTINATION_SHEET_NAME}" tab was repaired without deleting saved reviews. Column H is "Email Sent?" and the audit tab is ready.`
    );
  }
}

// Compatibility aliases for older cached QA Tracker menus.
// These prevent "Script function not found" after renaming the repair function.
function setupAgentsreviewedTab(showAlert = true) {
  return setupAgentsReviewedTab(showAlert);
}

function setupAgentsReviwedTab(showAlert = true) {
  return setupAgentsReviewedTab(showAlert);
}

function saveReview() {
  const sourceSheet = getActiveQaSheet_();
  if (!sourceSheet) return;

  const email = getAuthorizedUserEmail_();

  if (!isQaManagerEmail_(email)) {
    SpreadsheetApp.getUi().alert(
      "Save by checking G22 on your QA tab. The owner-installed trigger will save the review into the protected Agents Reviewed tab."
    );
    return;
  }

  saveReviewForSheet_(sourceSheet);
}

function saveReviewForSheet_(sourceSheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let lock = null;
  let lockAcquired = false;

  if (!sourceSheet || !isQaFormSheet_(sourceSheet)) {
    ss.toast("Please save from the Junior, Barbara, or Kelly QA tab.", "QA Tracker", 6);
    return;
  }

  ss.toast("Saving review... please wait.", "QA Tracker", 30);
  setSaveUiState_(sourceSheet, true);

  try {
    setEvaluatorForSheet_(sourceSheet, getConfiguredEvaluatorForSheet_(sourceSheet));

    const reviewData = getReviewData_(sourceSheet);
    const validationMessage = validateReview_(reviewData, sourceSheet);

    if (validationMessage) {
      ss.toast(validationMessage, "QA Tracker", 8);
      resetSaveCheckbox_(sourceSheet);
      return;
    }

    convertExistingCustomNotes_(sourceSheet);
    const customNotes = getCustomNotes_(sourceSheet);
    const rowData = buildSavedRow_(sourceSheet, reviewData, customNotes);

    lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    lockAcquired = true;

    const destinationSheet = getOrCreateDestinationSheet_(ss);
    ensureHeadersExist_(destinationSheet);

    const nextRow = destinationSheet.getLastRow() + 1;
    destinationSheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    applySavedRowFormatting_(destinationSheet, nextRow, rowData.length);
    applyCustomNotesToSavedRow_(destinationSheet, nextRow, customNotes);
    writeCallDetailsToSavedRow_(destinationSheet, nextRow, reviewData);
    SpreadsheetApp.flush();

    lock.releaseLock();
    lockAcquired = false;

    clearCurrentReview_(sourceSheet);
    ss.toast(`Saved to "${CONFIG.DESTINATION_SHEET_NAME}".`, "QA Tracker", 5);
  } catch (error) {
    ss.toast(`Save failed: ${error.message}`, "QA Tracker", 10);
    SpreadsheetApp.getUi().alert(`Save failed:\n\n${error.message}`);
  } finally {
    if (lock && lockAcquired) {
      try {
        lock.releaseLock();
      } catch (lockError) {
        // Ignore release errors because the save result has already been handled.
      }
    }

    setSaveUiState_(sourceSheet, false);
    resetSaveCheckbox_(sourceSheet);
    sourceSheet.getRange(CONFIG.SAVE_BUTTON_CELL).activate();
  }
}

function getReviewData_(sheet) {
  return {
    savedTimestamp: new Date(),
    reviewDate: sheet.getRange(CONFIG.REVIEW_DATE_CELL).getValue(),
    todayDate: sheet.getRange(CONFIG.TODAY_DATE_CELL).getValue(),
    evaluator: sheet.getRange(CONFIG.EVALUATOR_CELL).getValue(),
    agentName: sheet.getRange(CONFIG.AGENT_NAME_CELL).getValue(),
    callCenter: normalizeCallCenter_(sheet.getRange(CONFIG.CALL_CENTER_CELL).getValue()),
    callId: sheet.getRange(CONFIG.CALL_ID_CELL).getValue(),
    qaType: normalizeQaType_(sheet.getRange(CONFIG.QA_TYPE_CELL).getValue()),
    itineraryNumber: sheet.getRange(CONFIG.ITINERARY_NUMBER_CELL).getDisplayValue(),
    callLength: sheet.getRange(CONFIG.CALL_LENGTH_CELL).getDisplayValue(),
    callDate: sheet.getRange(CONFIG.CALL_DATE_CELL).getValue(),
    finalScore: sheet.getRange(CONFIG.FINAL_SCORE_CELL).getValue(),
    kpiTarget: sheet.getRange(CONFIG.KPI_TARGET_CELL).getValue(),
    result: sheet.getRange(CONFIG.RESULT_CELL).getValue(),
    markdowns: sheet.getRange(CONFIG.MARKDOWNS_CELL).getValue()
  };
}

function validateReview_(reviewData, sheet) {
  if (!reviewData.reviewDate) return "Please add the Start Date before saving.";
  if (!reviewData.todayDate) return "Please add Today's Date before saving.";
  if (!reviewData.evaluator) return "Please select the Evaluator before saving.";
  if (!reviewData.agentName) return "Please add the Agent Name before saving.";
  if (!reviewData.callCenter) return "Please select the Call Center before saving.";
  if (!reviewData.callId) return "Please add the Call ID before saving.";
  if (!reviewData.qaType) return "Please select the QA Type before saving.";

  if (!getEvaluatorOptions_().includes(String(reviewData.evaluator || "").trim())) {
    return "Please select a configured QA evaluator.";
  }

  if (isKellySheet_(sheet)) {
    const callId = normalizeKellyCallId_(reviewData.callId);
    const itinerary = normalizeKellyItinerary_(reviewData.itineraryNumber);

    if (!isValidKellyCallId_(callId)) {
      return "Kelly: Call ID must start with CA followed by exactly 32 hexadecimal characters. Example: CA1579daea5e20c6f8c42d09d1c4158cff";
    }

    if (!isValidKellyItinerary_(itinerary)) {
      return "Kelly: Please add an itinerary, hotel confirmation, supplier confirmation, reservation number, or booking reference in C10.";
    }

    if (!String(reviewData.callLength || "").trim()) {
      return "Kelly: Please add the Length of Call in F8 before saving.";
    }

    if (!reviewData.callDate) {
      return "Kelly: Please add the Date of Call in F9 before saving.";
    }

    const criteriaNames = sheet.getRange(
      CONFIG.CRITERIA_START_ROW,
      CONFIG.CRITERIA_NAME_COL,
      CONFIG.CRITERIA_END_ROW - CONFIG.CRITERIA_START_ROW + 1,
      1
    ).getDisplayValues().flat();

    const criteriaStatuses = sheet.getRange(
      CONFIG.CRITERIA_START_ROW,
      CONFIG.STATUS_COL,
      CONFIG.CRITERIA_END_ROW - CONFIG.CRITERIA_START_ROW + 1,
      1
    ).getDisplayValues().flat();

    for (let index = 0; index < criteriaNames.length; index++) {
      const criteriaName = String(criteriaNames[index] || "").trim();
      const status = String(criteriaStatuses[index] || "").trim();
      const row = CONFIG.CRITERIA_START_ROW + index;

      if (criteriaName && !status) {
        return `Kelly: Select a status in E${row} for every visible criterion before saving.`;
      }

      if (criteriaName && /markdown|partial/i.test(status)) {
        const noteCell = sheet.getRange(row, CONFIG.CUSTOM_NOTES_COL);
        const note = String(noteCell.getNote() || noteCell.getValue() || "").trim();

        if (!note || note === CONFIG.CUSTOM_NOTES_PLACEHOLDER || note === "Your tex...") {
          return `Kelly: Add a clear explanation in I${row} for the ${status} selection before saving.`;
        }
      }
    }
  }

  const reviewDate = new Date(reviewData.reviewDate);
  const todayDate = new Date(reviewData.todayDate);
  const actualToday = new Date();

  reviewDate.setHours(0, 0, 0, 0);
  todayDate.setHours(0, 0, 0, 0);
  actualToday.setHours(0, 0, 0, 0);

  const sixYearsAgo = new Date(actualToday);
  sixYearsAgo.setMonth(sixYearsAgo.getMonth() - 72);

  const startOf2026 = new Date(2026, 0, 1);
  const endOf2026 = new Date(2026, 11, 31);

  const reviewDateIsValid =
    (reviewDate >= sixYearsAgo && reviewDate <= actualToday) ||
    (reviewDate >= startOf2026 && reviewDate <= endOf2026);

  if (!reviewDateIsValid) {
    return "Start Date must be within the last 6 years or any date in 2026.";
  }

  if (todayDate.getTime() !== actualToday.getTime()) {
    return "Today's Date must be today's actual date.";
  }

  const validCallCenters = CALL_CENTER_OPTIONS.map(option => option.toLowerCase());
  if (!validCallCenters.includes(String(reviewData.callCenter).toLowerCase())) {
    return "Please use one of these Call Centers: WNS, Concentrix, Buwelo-G, Buwelo-C, Telus.";
  }

  const statuses = sheet
    .getRange(
      CONFIG.CRITERIA_START_ROW,
      CONFIG.STATUS_COL,
      CONFIG.CRITERIA_END_ROW - CONFIG.CRITERIA_START_ROW + 1,
      1
    )
    .getValues()
    .flat();

  const hasSelection = statuses.some(value => value !== "" && value !== null);

  if (!hasSelection) {
    return "Please select at least one QA criterion before saving.";
  }

  return "";
}

function buildSavedRow_(sheet, reviewData, customNotes) {
  const rowData = [
    reviewData.savedTimestamp,
    reviewData.reviewDate,
    reviewData.todayDate,
    reviewData.evaluator,
    reviewData.agentName,
    reviewData.callCenter,
    reviewData.callId,
    false,
    reviewData.qaType,
    reviewData.finalScore,
    reviewData.kpiTarget,
    reviewData.result,
    reviewData.markdowns
  ];

  for (let row = CONFIG.CRITERIA_START_ROW; row <= CONFIG.CRITERIA_END_ROW; row++) {
    rowData.push(sheet.getRange(row, CONFIG.CRITERIA_NUMBER_COL).getValue());
    rowData.push(sheet.getRange(row, CONFIG.CRITERIA_NAME_COL).getValue());
    rowData.push(sheet.getRange(row, CONFIG.MAX_POINTS_COL).getValue());
    rowData.push(sheet.getRange(row, CONFIG.STATUS_COL).getValue());
    rowData.push(sheet.getRange(row, CONFIG.PARTIAL_POINTS_COL).getValue());
    rowData.push(sheet.getRange(row, CONFIG.AUTO_POINTS_COL).getValue());
    rowData.push(sheet.getRange(row, CONFIG.NOTES_COL).getValue());
  }

  customNotes.forEach(note => {
    rowData.push(note.preview);
  });

  // Appended at the end so existing saved columns never shift.
  rowData.push(reviewData.itineraryNumber || "");

  return rowData;
}

function buildHeaders_() {
  const headers = [
    "Saved Timestamp",
    "Agent Start Date",
    "Today's Date",
    "Evaluator",
    "Agent Name",
    "Call Center",
    "Call ID",
    CONFIG.EMAIL_SENT_HEADER,
    "QA Type",
    "Final Score",
    "KPI Target",
    "Result",
    "Markdowns"
  ];

  for (let i = 1; i <= 9; i++) {
    headers.push(`Criteria ${i} #`);
    headers.push(`Criteria ${i} Name`);
    headers.push(`Criteria ${i} Max Points`);
    headers.push(`Criteria ${i} Status`);
    headers.push(`Criteria ${i} Partial Points`);
    headers.push(`Criteria ${i} Auto Points`);
    headers.push(`Criteria ${i} Notes / Issue Found`);
  }

  for (let i = 1; i <= 9; i++) {
    headers.push(`Custom Note ${i}`);
  }

  // Keep this as the final column to preserve every existing saved review.
  headers.push("Itinerary Number");

  return headers;
}

function getOrCreateDestinationSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.DESTINATION_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DESTINATION_SHEET_NAME);
  }

  return sheet;
}

function ensureHeadersExist_(sheet) {
  ensureEmailSentColumn_(sheet);
  const headers = buildHeaders_();

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    formatDestinationSheet_(sheet, headers.length);
    ensureCallDetailColumns_(sheet);
    setupEmailSentCheckboxes_(sheet);
    fixEvaluatorDropdowns(false);
    return;
  }

  // Existing columns and rows are never shifted. Missing call-detail headers
  // are appended after the current last used column.
  ensureCallDetailColumns_(sheet);
}

function ensureCallDetailColumns_(sheet) {
  if (!sheet) {
    throw new Error(`The "${CONFIG.DESTINATION_SHEET_NAME}" tab was not found.`);
  }

  let lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];

  const findHeaderColumn = headerName => {
    const index = headers.findIndex(header =>
      String(header || "").trim().toLowerCase() ===
      String(headerName || "").trim().toLowerCase()
    );

    return index >= 0 ? index + 1 : 0;
  };

  let callLengthColumn = findHeaderColumn(CONFIG.CALL_LENGTH_HEADER);
  let callDateColumn = findHeaderColumn(CONFIG.CALL_DATE_HEADER);

  const appendHeader = headerName => {
    lastColumn = Math.max(sheet.getLastColumn(), lastColumn) + 1;
    const cell = sheet.getRange(1, lastColumn);

    cell
      .setValue(headerName)
      .setFontWeight("bold")
      .setFontColor("#ffffff")
      .setBackground("#1f4e78")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);

    sheet.setColumnWidth(lastColumn, 125);
    headers.push(headerName);
    return lastColumn;
  };

  if (!callLengthColumn) {
    callLengthColumn = appendHeader(CONFIG.CALL_LENGTH_HEADER);
  }

  if (!callDateColumn) {
    callDateColumn = appendHeader(CONFIG.CALL_DATE_HEADER);
  }

  return {
    callLengthColumn: callLengthColumn,
    callDateColumn: callDateColumn
  };
}

function writeCallDetailsToSavedRow_(sheet, row, reviewData) {
  const columns = ensureCallDetailColumns_(sheet);
  const lengthCell = sheet.getRange(row, columns.callLengthColumn);
  const dateCell = sheet.getRange(row, columns.callDateColumn);
  const callLength = String(reviewData.callLength || "").trim();

  lengthCell.setNumberFormat("@");

  if (callLength) {
    lengthCell.setValue(callLength);
  } else {
    lengthCell.clearContent();
  }

  if (reviewData.callDate) {
    dateCell.setValue(reviewData.callDate);
    dateCell.setNumberFormat("m/d/yyyy");
  } else {
    dateCell.clearContent();
    dateCell.setNumberFormat("m/d/yyyy");
  }

  sheet.getRange(row, columns.callLengthColumn, 1, 1)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(false);

  sheet.getRange(row, columns.callDateColumn, 1, 1)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(false);
}

function formatDestinationSheet_(sheet, headerLength) {
  sheet.setFrozenRows(1);

  const headerRange = sheet.getRange(1, 1, 1, headerLength);
  headerRange
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1f4e78")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.getRange(1, 1, sheet.getMaxRows(), headerLength).setWrap(true);

  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 160);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 280);
  sheet.setColumnWidth(8, 110);
  sheet.setColumnWidth(9, 100);
  sheet.setColumnWidth(10, 100);
  sheet.setColumnWidth(11, 100);
  sheet.setColumnWidth(12, 100);
  sheet.setColumnWidth(13, 100);

  for (let col = 14; col <= headerLength; col++) {
    sheet.setColumnWidth(col, 160);
  }

  const customNotesStartCol = getCustomNotesStartCol_();

  for (let col = customNotesStartCol; col < customNotesStartCol + 9; col++) {
    sheet.setColumnWidth(col, 110);
  }

  // The filter must cover the header AND every review row.
  // A header-only filter opens normally but clicking OK does not filter the data.
  const existingFilter = sheet.getFilter();

  if (existingFilter) {
    existingFilter.remove();
  }

  sheet
    .getRange(1, 1, sheet.getMaxRows(), headerLength)
    .createFilter();
}

function applySavedRowFormatting_(sheet, row, totalColumns) {
  sheet.getRange(row, 1, 1, totalColumns)
    .setVerticalAlignment("middle")
    .setWrap(true);

  const resultCell = sheet.getRange(row, getHeaderColumn_("Result"));
  const result = String(resultCell.getValue()).toUpperCase();

  if (result === "PASS") {
    resultCell
      .setBackground("#d9ead3")
      .setFontColor("#274e13")
      .setFontWeight("bold");
  }

  if (result === "FAIL") {
    resultCell
      .setBackground("#f4cccc")
      .setFontColor("#990000")
      .setFontWeight("bold");
  }

  const emailSentCell = sheet.getRange(row, CONFIG.EMAIL_SENT_COLUMN);
  emailSentCell.insertCheckboxes();
  emailSentCell.setValue(false);
  emailSentCell
    .setBackground("#ffffff")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("Junior or Barbara checks this after the weekly review email is sent.");

  const customNotesStartCol = getCustomNotesStartCol_();

  sheet.getRange(row, customNotesStartCol, 1, 9)
    .setBackground("#fff7ed")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(false);
}

function ensureEmailSentColumn_(sheet) {
  if (!sheet) return;

  const currentHeader = String(
    sheet.getRange(1, CONFIG.EMAIL_SENT_COLUMN).getDisplayValue() || ""
  ).trim();

  if (currentHeader.toLowerCase() === CONFIG.EMAIL_SENT_HEADER.toLowerCase()) {
    return;
  }

  const lastColumn = Math.max(sheet.getLastColumn(), CONFIG.EMAIL_SENT_COLUMN);
  const headerValues = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const qaTypeIndex = headerValues.findIndex(
    value => String(value || "").trim().toLowerCase() === "qa type"
  );

  if (qaTypeIndex === CONFIG.EMAIL_SENT_COLUMN - 1) {
    sheet.insertColumnBefore(CONFIG.EMAIL_SENT_COLUMN);
  }

  sheet.getRange(1, CONFIG.EMAIL_SENT_COLUMN).setValue(CONFIG.EMAIL_SENT_HEADER);
}

function setupEmailSentCheckboxes_(sheet) {
  if (!sheet) return;

  const lastDataRow = sheet.getLastRow();
  if (lastDataRow < 2) return;

  const rowCount = lastDataRow - 1;
  const range = sheet.getRange(2, CONFIG.EMAIL_SENT_COLUMN, rowCount, 1);
  range.insertCheckboxes();
  range
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("Junior or Barbara checks this after the weekly review email is sent.");

  const values = range.getValues();
  let changed = false;

  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === "" || values[i][0] === null) {
      values[i][0] = false;
      changed = true;
    }
  }

  if (changed) range.setValues(values);
}

function setupEmailSentDetailsTab_(ss) {
  const sourceSheet = ss.getSheetByName(CONFIG.DESTINATION_SHEET_NAME);
  const headers = buildEmailSentDetailsHeaders_(sourceSheet);
  let sheet = ss.getSheetByName(CONFIG.EMAIL_DETAILS_SHEET_NAME);
  let schemaNeedsSetup = false;

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.EMAIL_DETAILS_SHEET_NAME);
    schemaNeedsSetup = true;
  } else {
    const existingColumnCount = Math.min(sheet.getLastColumn(), headers.length);
    const existingHeaders = existingColumnCount > 0
      ? sheet.getRange(1, 1, 1, existingColumnCount).getDisplayValues()[0]
      : [];

    const schemaMatches =
      existingHeaders.length === headers.length &&
      headers.every((header, index) =>
        String(existingHeaders[index] || "").trim() === String(header || "").trim()
      );

    if (!schemaMatches) {
      if (sheet.getLastRow() > 1) {
        const legacyName = getUniqueSheetName_(
          ss,
          `${CONFIG.EMAIL_DETAILS_SHEET_NAME} legacy ${Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd-HHmmss"
          )}`
        );

        sheet.setName(legacyName);
        sheet = ss.insertSheet(CONFIG.EMAIL_DETAILS_SHEET_NAME);
      } else {
        const oldFilter = sheet.getFilter();
        if (oldFilter) oldFilter.remove();
        sheet.clear();
      }

      schemaNeedsSetup = true;
    }
  }

  if (!schemaNeedsSetup) return sheet;

  ensureSheetHasColumns_(sheet, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1f4e78")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.setColumnWidth(1, 165);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 260);

  const sourceColumnCount =
    CONFIG.EMAIL_DETAILS_COPY_END_COLUMN -
    CONFIG.EMAIL_DETAILS_COPY_START_COLUMN +
    1;

  for (let index = 0; index < sourceColumnCount; index++) {
    const sourceColumn = CONFIG.EMAIL_DETAILS_COPY_START_COLUMN + index;
    const logColumn = CONFIG.EMAIL_DETAILS_METADATA_COLUMNS + 1 + index;
    const sourceWidth = sourceSheet
      ? sourceSheet.getColumnWidth(sourceColumn)
      : 140;

    sheet.setColumnWidth(logColumn, Math.max(90, Math.min(sourceWidth, 300)));
  }

  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 1), headers.length)
    .setVerticalAlignment("middle")
    .setWrap(true);

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, 1, headers.length).createFilter();
  }

  return sheet;
}

function buildEmailSentDetailsHeaders_(sourceSheet) {
  const startColumn = CONFIG.EMAIL_DETAILS_COPY_START_COLUMN;
  const endColumn = CONFIG.EMAIL_DETAILS_COPY_END_COLUMN;
  const columnCount = endColumn - startColumn + 1;
  const sourceHeaders = sourceSheet
    ? sourceSheet.getRange(1, startColumn, 1, columnCount).getDisplayValues()[0]
    : new Array(columnCount).fill("");

  const copiedHeaders = sourceHeaders.map((header, index) => {
    const sourceColumn = startColumn + index;
    const columnLetter = columnNumberToLetter_(sourceColumn);
    const cleanedHeader = String(header || "").trim();

    return cleanedHeader
      ? `[${columnLetter}] ${cleanedHeader}`
      : `[${columnLetter}] Source Column ${columnLetter}`;
  });

  return ["Timestamp", "Action", "Review Row", "Checked By"].concat(copiedHeaders);
}

function ensureSheetHasColumns_(sheet, requiredColumns) {
  const currentColumns = sheet.getMaxColumns();

  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function getUniqueSheetName_(ss, requestedName) {
  const baseName = String(requestedName || "Sheet").substring(0, 90);
  let name = baseName;
  let counter = 2;

  while (ss.getSheetByName(name)) {
    name = `${baseName.substring(0, 85)} ${counter}`;
    counter++;
  }

  return name;
}

function columnNumberToLetter_(columnNumber) {
  let number = Number(columnNumber);
  let letters = "";

  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }

  return letters;
}

function protectQaManagerSheet_(sheet, description) {
  if (!sheet) return;

  const managerEmails = description === QA_ACCESS_CONFIG.RESULTS_PROTECTION_DESCRIPTION
    ? getAgentsReviewedEditorEmails_()
    : getQaManagerEmails_();
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  let protection = protections.find(
    item => item.getDescription() === description
  );

  if (!protection) {
    protection = sheet.protect().setDescription(description);
  }

  protection.setWarningOnly(false);

  managerEmails.forEach(email => {
    try {
      protection.addEditor(email);
    } catch (error) {
      // The account may not yet have file-level access. The owner can add it later.
    }
  });

  try {
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
  } catch (error) {
    // Consumer-owned sheets may not expose domain-edit controls.
  }

  const allowed = new Set(managerEmails);
  const currentEffective = getAuthorizedUserEmail_();
  if (currentEffective) allowed.add(currentEffective);

  const editorsToRemove = protection.getEditors().filter(user => {
    const email = String(user.getEmail() || "").trim().toLowerCase();
    return email && !allowed.has(email);
  });

  if (editorsToRemove.length) {
    try {
      protection.removeEditors(editorsToRemove);
    } catch (error) {
      editorsToRemove.forEach(user => {
        try {
          protection.removeEditor(user);
        } catch (ignored) {
          // Ignore inherited group permissions; domain editing was disabled above.
        }
      });
    }
  }

  getKellyEmails_().forEach(email => {
    try {
      protection.removeEditor(email);
    } catch (error) {
      // Kelly may not be listed directly on the protection.
    }
  });
}

function handleEmailSentCheckboxEdit_(e) {
  const sheet = e.range.getSheet();
  const row = e.range.getRow();
  const checked = String(e.value || "").toUpperCase() === "TRUE";
  const actorEmail = getEditActorEmail_(e);
  const now = new Date();

  if (
    actorEmail !== "authorized editor (email unavailable)" &&
    !isQaManagerEmail_(actorEmail)
  ) {
    e.range.setValue(false);
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "Only Junior or Barbara can update Email Sent.",
      "QA Tracker",
      5
    );
    return;
  }

  const action = checked ? "EMAIL SENT" : "UNCHECKED";
  const checkbox = e.range;

  checkbox
    .setBackground(checked ? "#d9ead3" : "#ffffff")
    .setFontWeight(checked ? "bold" : "normal")
    .setNote(
      `${action} on ${Utilities.formatDate(now, Session.getScriptTimeZone(), "M/d/yyyy h:mm a")} by ${actorEmail}`
    );

  SpreadsheetApp.flush();

  const sourceColumnCount =
    CONFIG.EMAIL_DETAILS_COPY_END_COLUMN -
    CONFIG.EMAIL_DETAILS_COPY_START_COLUMN +
    1;
  const sourceRange = sheet.getRange(
    row,
    CONFIG.EMAIL_DETAILS_COPY_START_COLUMN,
    1,
    sourceColumnCount
  );
  const sourceValues = sourceRange.getValues()[0];
  const sourceNotes = sourceRange.getNotes()[0];
  const sourceNumberFormats = sourceRange.getNumberFormats()[0];

  const logSheet = setupEmailSentDetailsTab_(SpreadsheetApp.getActiveSpreadsheet());
  const logRow = [now, action, row, actorEmail].concat(sourceValues);
  const nextRow = logSheet.getLastRow() + 1;

  logSheet.getRange(nextRow, 1, 1, logRow.length).setValues([logRow]);
  logSheet.getRange(nextRow, 1).setNumberFormat("m/d/yyyy h:mm AM/PM");

  const copiedRange = logSheet.getRange(
    nextRow,
    CONFIG.EMAIL_DETAILS_METADATA_COLUMNS + 1,
    1,
    sourceColumnCount
  );
  copiedRange.setNotes([sourceNotes]);
  copiedRange.setNumberFormats([sourceNumberFormats]);

  logSheet.getRange(nextRow, 1, 1, logRow.length)
    .setVerticalAlignment("middle")
    .setWrap(true);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    checked
      ? "Email sent was recorded with the full A:CH review."
      : "The checkbox was cleared and the full A:CH review was logged.",
    "QA Tracker",
    4
  );
}

function clearCurrentReview_(sheet) {
  CONFIG.CLEAR_RANGES_AFTER_SAVE.forEach(a1 => {
    sheet.getRange(a1).clearContent();
  });

  sheet.getRange(CONFIG.CUSTOM_NOTES_RANGE).clearNote();

  setEvaluatorForSheet_(sheet, getConfiguredEvaluatorForSheet_(sheet));
  setupDateRules_(sheet);
  setupItineraryField_(sheet);
  setupCallDetailsForSheet_(sheet);

  if (isKellySheet_(sheet)) {
    setupKellyFieldRules_(sheet);
    protectKellyTab_(sheet);
  }

  resetSaveCheckbox_(sheet);
  sheet.getRange(CONFIG.SAVE_BUTTON_CELL).activate();
}

function resetSaveCheckbox_(sheet) {
  const range = sheet.getRange(CONFIG.SAVE_BUTTON_CELL);

  if (range.isChecked() !== null) {
    range.setValue(false);
  }
}

function isCustomNoteCell_(range) {
  return (
    range.getColumn() === CONFIG.CUSTOM_NOTES_COL &&
    range.getRow() >= CONFIG.CUSTOM_NOTES_START_ROW &&
    range.getRow() <= CONFIG.CUSTOM_NOTES_END_ROW
  );
}

function isPlaceholderCustomNote_(value) {
  return String(value || "").trim() === CONFIG.CUSTOM_NOTES_PLACEHOLDER;
}

function handleCustomNoteEdit_(range, editedValue) {
  const fullText = editedValue === undefined || editedValue === null
    ? ""
    : String(editedValue).trim();

  if (!fullText) {
    range.clearContent();
    range.clearNote();
    return;
  }

  // Save the complete note immediately. Do not wait five seconds.
  // The cell displays a short preview and the full text stays in its note.
  range.setNote(fullText);
  range.setValue(shortenText_(fullText));
  range
    .setBackground("#fff7ed")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(false);
}

function convertExistingCustomNotes_(sheet) {
  for (let row = CONFIG.CUSTOM_NOTES_START_ROW; row <= CONFIG.CUSTOM_NOTES_END_ROW; row++) {
    const cell = sheet.getRange(row, CONFIG.CUSTOM_NOTES_COL);
    const value = String(cell.getValue() || "").trim();
    const rawNote = String(cell.getNote() || "").trim();
    const note = isPlaceholderCustomNote_(rawNote) ? "" : rawNote;

    if (!value && !note) {
      cell.clearNote();
      continue;
    }

    // If an old blank cell only contains the old placeholder preview, clear it.
    if (!note && (value === "Your tex..." || isPlaceholderCustomNote_(value))) {
      cell.clearContent();
      cell.clearNote();
      continue;
    }

    const fullText = note || value;
    cell.setNote(fullText);
    cell.setValue(shortenText_(fullText));
    cell
      .setBackground("#fff7ed")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(false);
  }
}

function getCustomNotes_(sheet) {
  const notes = [];

  for (let row = CONFIG.CUSTOM_NOTES_START_ROW; row <= CONFIG.CUSTOM_NOTES_END_ROW; row++) {
    const cell = sheet.getRange(row, CONFIG.CUSTOM_NOTES_COL);
    const rawNote = String(cell.getNote() || "").trim();
    const value = String(cell.getValue() || "").trim();
    const note = isPlaceholderCustomNote_(rawNote) ? "" : rawNote;

    let fullText = note || value;

    if (fullText === "Your tex..." || isPlaceholderCustomNote_(fullText)) {
      fullText = "";
    }

    notes.push({
      fullText: fullText,
      preview: fullText ? shortenText_(fullText) : ""
    });
  }

  return notes;
}

function applyCustomNotesToSavedRow_(sheet, row, customNotes) {
  const startCol = getCustomNotesStartCol_();

  customNotes.forEach((note, index) => {
    const cell = sheet.getRange(row, startCol + index);

    if (note.fullText) {
      cell.setValue(note.preview);
      cell.setNote(note.fullText);
    } else {
      cell.clearContent();
      cell.clearNote();
    }
  });
}

function getHeaderColumn_(headerName) {
  const headers = buildHeaders_();
  const index = headers.findIndex(
    header => String(header || "").trim().toLowerCase() === String(headerName || "").trim().toLowerCase()
  );

  if (index < 0) {
    throw new Error(`Header "${headerName}" was not found.`);
  }

  return index + 1;
}

function getCustomNotesStartCol_() {
  return getHeaderColumn_("Custom Note 1");
}

function shortenText_(text) {
  const cleaned = String(text || "").trim();

  if (cleaned.length <= CONFIG.CUSTOM_NOTES_VISIBLE_CHARS) {
    return cleaned;
  }

  return cleaned.substring(0, CONFIG.CUSTOM_NOTES_VISIBLE_CHARS) + "...";
}

function normalizeCallCenter_(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  const map = {
    "wns": "WNS",
    "concentrix": "Concentrix",
    "telus": "Telus",

    "buwelo-g": "Buwelo-G",
    "buwelo - g": "Buwelo-G",
    "buwelo g": "Buwelo-G",
    "buwelog": "Buwelo-G",
    "buwelo ghana": "Buwelo-G",
    "ghana": "Buwelo-G",

    "buwelo-c": "Buwelo-C",
    "buwelo - c": "Buwelo-C",
    "buwelo c": "Buwelo-C",
    "buweloc": "Buwelo-C",
    "buwelo colombia": "Buwelo-C",
    "colombia": "Buwelo-C"
  };

  return map[cleaned] || value;
}

function normalizeQaType_(value) {
  const cleaned = String(value || "").trim().toLowerCase();

  if (cleaned === "cs" || cleaned === "customer service") return "CS";
  if (cleaned === "groups" || cleaned === "group") return "Groups";

  return value;
}

// -----------------------------------------------------------------------------
// AGENT PICKS WEB API
// -----------------------------------------------------------------------------
// This API is read-only. It exposes only the "Agents Reviewed" tab used by the
// React dashboard. It does not modify the QA form or the saved review data.

const AGENT_PICKS_API_CONFIG = {
  SPREADSHEET_ID: "1GpR3siePgY45jGJfsAB2Q1obCW34A-tfKJOrI8ruEwg",
  SHEET_NAME: "Agents Reviewed",
  API_KEY: "b3ab35174e973e9a2691537ddfe76660dea5516b114c70de3e9b5c19bbae0aaf",
  CACHE_SECONDS: 60,
  MAX_ROWS: 10000
};

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callbackName = String(params.callback || "").trim();

  try {
    const expectedKey = String(AGENT_PICKS_API_CONFIG.API_KEY || "").trim();

    if (expectedKey && String(params.key || "") !== expectedKey) {
      return agentPicksJson_(
        {
          success: false,
          message: "Unauthorized request. Invalid API key."
        },
        callbackName
      );
    }

    const action = String(params.action || "dashboard").trim().toLowerCase();

    if (action !== "dashboard" && action !== "reviews") {
      return agentPicksJson_(
        {
          success: false,
          message: "Unsupported action. Use action=dashboard."
        },
        callbackName
      );
    }

    const cache = CacheService.getScriptCache();
    const cacheKey = "agent-picks-agents-reviewed-v6-full-notes";
    const cached = cache.get(cacheKey);

    if (cached && String(params.refresh || "") !== "1") {
      return agentPicksTextOutput_(cached, callbackName);
    }

    const spreadsheet = SpreadsheetApp.openById(
      AGENT_PICKS_API_CONFIG.SPREADSHEET_ID
    );
    const sheet = spreadsheet.getSheetByName(
      AGENT_PICKS_API_CONFIG.SHEET_NAME
    );

    if (!sheet) {
      throw new Error(
        `Sheet "${AGENT_PICKS_API_CONFIG.SHEET_NAME}" was not found.`
      );
    }

    const lastRow = Math.min(
      sheet.getLastRow(),
      AGENT_PICKS_API_CONFIG.MAX_ROWS
    );
    const lastColumn = sheet.getLastColumn();

    if (lastRow < 2 || lastColumn < 1) {
      return agentPicksJson_(
        {
          success: true,
          generatedAt: new Date().toISOString(),
          sourceSheet: AGENT_PICKS_API_CONFIG.SHEET_NAME,
          reviews: [],
          meta: {
            reviewRows: 0,
            uniqueAgents: 0,
            csKpi: 90,
            groupsKpi: 85,
            criticalScore: 50,
            specialCorrectionPhoneDays: 60
          }
        },
        callbackName
      );
    }

    const range = sheet.getRange(1, 1, lastRow, lastColumn);
    const values = range.getValues();
    const displayValues = range.getDisplayValues();
    const cellNotes = range.getNotes();
    const headers = displayValues[0].map(header => String(header || "").trim());
    const headerIndex = buildAgentPicksHeaderIndex_(headers);
    const reviews = [];
    const uniqueAgents = {};

    for (let index = 1; index < values.length; index++) {
      const rowValues = values[index];
      const rowDisplay = displayValues[index];
      const rowNotes = cellNotes[index];
      const agentName = cleanAgentPicksText_(
        readAgentPicksColumn_(rowDisplay, headerIndex, ["Agent Name"])
      );

      if (!agentName) continue;

      const score = agentPicksNumber_(
        readAgentPicksColumn_(rowValues, headerIndex, ["Final Score"])
      );
      const qaType = normalizeQaType_(
        readAgentPicksColumn_(rowDisplay, headerIndex, ["QA Type"])
      );

      if (score === null || !qaType) continue;

      const callCenter = normalizeCallCenter_(
        readAgentPicksColumn_(rowDisplay, headerIndex, ["Call Center"])
      );
      const agentStartValue = readAgentPicksColumn_(
        rowValues,
        headerIndex,
        ["Agent Start Date", "Start Date", "Review Date"]
      );
      const reviewDateValue = readAgentPicksColumn_(
        rowValues,
        headerIndex,
        ["Today's Date", "Review Completed Date"]
      );
      const savedTimestampValue = readAgentPicksColumn_(
        rowValues,
        headerIndex,
        ["Saved Timestamp"]
      );

      const criteria = buildAgentPicksCriteria_(
        rowDisplay,
        rowNotes,
        headerIndex
      );

      const issueSummary = buildAgentPicksIssueSummary_(criteria);

      const review = {
        id: `agents-reviewed-${index + 1}`,
        rowNumber: index + 1,
        savedTimestamp: agentPicksDateIso_(savedTimestampValue, true),
        agentStartDate: agentPicksDateIso_(agentStartValue, false),
        reviewDate: agentPicksDateIso_(
          reviewDateValue || savedTimestampValue,
          false
        ),
        evaluator: cleanAgentPicksText_(
          readAgentPicksColumn_(rowDisplay, headerIndex, ["Evaluator"])
        ),
        agentName: agentName,
        callCenter: cleanAgentPicksText_(callCenter),
        callId: cleanAgentPicksText_(
          readAgentPicksColumn_(rowDisplay, headerIndex, ["Call ID"])
        ),
        itineraryNumber: cleanAgentPicksText_(
          readAgentPicksColumn_(rowDisplay, headerIndex, ["Itinerary Number"])
        ),
        emailSent: agentPicksBoolean_(
          readAgentPicksColumn_(rowValues, headerIndex, [CONFIG.EMAIL_SENT_HEADER])
        ),
        qaType: qaType,
        finalScore: score,
        kpiTarget: qaType === "Groups" ? 85 : 90,
        result: score >= (qaType === "Groups" ? 85 : 90) ? "PASS" : "FAIL",
        markdowns: agentPicksNumber_(
          readAgentPicksColumn_(rowValues, headerIndex, ["Markdowns"])
        ) || 0,
        callLength: cleanAgentPicksText_(
          readAgentPicksColumn_(
            rowDisplay,
            headerIndex,
            ["Length of Call", "Call Length"]
          )
        ),
        callDate: agentPicksDateIso_(
          readAgentPicksColumn_(
            rowValues,
            headerIndex,
            ["Date of Call", "Call Date"]
          ),
          false
        ),
        criteria: criteria,
        issueSummary: issueSummary
      };

      reviews.push(review);
      uniqueAgents[`${String(callCenter).toLowerCase()}|${agentName.toLowerCase()}`] = true;
    }

    const payload = {
      success: true,
      generatedAt: new Date().toISOString(),
      spreadsheetId: AGENT_PICKS_API_CONFIG.SPREADSHEET_ID,
      sourceSheet: AGENT_PICKS_API_CONFIG.SHEET_NAME,
      reviews: reviews,
      meta: {
        reviewRows: reviews.length,
        uniqueAgents: Object.keys(uniqueAgents).length,
        csKpi: 90,
        groupsKpi: 85,
        criticalScore: 50,
        specialCorrectionPhoneDays: 60,
        startDateSource: "C3 saved to Agent Start Date / legacy Review Date column",
        reviewDateSource: "C4 saved to Today's Date column"
      }
    };

    const json = JSON.stringify(payload);

    if (json.length < 90000) {
      try {
        cache.put(cacheKey, json, AGENT_PICKS_API_CONFIG.CACHE_SECONDS);
      } catch (cacheError) {
        // Cache failure must never block the dashboard response.
      }
    }

    return agentPicksTextOutput_(json, callbackName);
  } catch (error) {
    return agentPicksJson_(
      {
        success: false,
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : ""
      },
      callbackName
    );
  }
}

function buildAgentPicksHeaderIndex_(headers) {
  const index = {};

  headers.forEach((header, position) => {
    const normalized = String(header || "").trim().toLowerCase();
    if (normalized && index[normalized] === undefined) {
      index[normalized] = position;
    }
  });

  return index;
}

function readAgentPicksColumn_(row, headerIndex, names) {
  for (let i = 0; i < names.length; i++) {
    const position = headerIndex[String(names[i]).trim().toLowerCase()];
    if (position !== undefined) return row[position];
  }

  return "";
}

function cleanAgentPicksText_(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s+/g, " ");
}

function agentPicksNumber_(value) {
  if (value === "" || value === null || value === undefined) return null;

  const number = Number(String(value).replace("%", "").trim());
  return isFinite(number) ? number : null;
}

function agentPicksBoolean_(value) {
  if (value === true) return true;
  return String(value || "").trim().toLowerCase() === "true";
}

function agentPicksDateIso_(value, includeTime) {
  if (!value) return "";

  let date = value;

  if (Object.prototype.toString.call(value) !== "[object Date]") {
    date = new Date(value);
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) return "";

  if (includeTime) return date.toISOString();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildAgentPicksCriteria_(rowDisplay, rowNotes, headerIndex) {
  const criteria = [];

  for (let number = 1; number <= 9; number++) {
    const criterionNumber = cleanAgentPicksText_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} #`]
      )
    );

    const name = cleanAgentPicksText_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} Name`]
      )
    );

    const maxPointsValue = agentPicksNumber_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} Max Points`]
      )
    );

    const status = cleanAgentPicksText_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} Status`]
      )
    );

    const partialPointsValue = agentPicksNumber_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} Partial Points`]
      )
    );

    const autoPointsValue = agentPicksNumber_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} Auto Points`]
      )
    );

    const matrixNotes = cleanAgentPicksText_(
      readAgentPicksColumn_(
        rowDisplay,
        headerIndex,
        [`Criteria ${number} Notes / Issue Found`]
      )
    );

    const customNoteHeader = `Custom Note ${number}`;
    const customNotePosition =
      headerIndex[customNoteHeader.toLowerCase()];

    let customNote = "";

    if (
      customNotePosition !== undefined &&
      rowNotes &&
      rowNotes[customNotePosition]
    ) {
      customNote = cleanAgentPicksText_(rowNotes[customNotePosition]);
    }

    if (!customNote && customNotePosition !== undefined) {
      customNote = cleanAgentPicksText_(rowDisplay[customNotePosition]);

      if (
        customNote === "Your tex..." ||
        customNote === "Your text..." ||
        customNote === CONFIG.CUSTOM_NOTES_PLACEHOLDER
      ) {
        customNote = "";
      }
    }

    if (!name && !status && !customNote && !matrixNotes) {
      continue;
    }

    criteria.push({
      number: Number(criterionNumber) || number,
      name: name,
      points: maxPointsValue === null ? 0 : maxPointsValue,
      status: status,
      partialPoints: partialPointsValue === null ? 0 : partialPointsValue,
      autoPoints: autoPointsValue === null ? 0 : autoPointsValue,
      notes: matrixNotes,
      customNote: customNote
    });
  }

  return criteria;
}

function buildAgentPicksIssueSummary_(criteria) {
  return (Array.isArray(criteria) ? criteria : [])
    .filter(item => {
      return Boolean(
        cleanAgentPicksText_(item.customNote) ||
        /markdown|partial/i.test(cleanAgentPicksText_(item.status))
      );
    })
    .map(item => {
      const note =
        cleanAgentPicksText_(item.customNote) ||
        cleanAgentPicksText_(item.notes);

      return [
        cleanAgentPicksText_(item.name),
        cleanAgentPicksText_(item.status),
        note
      ]
        .filter(Boolean)
        .join(" - ");
    })
    .join(" | ");
}

function agentPicksJson_(payload, callbackName) {
  return agentPicksTextOutput_(JSON.stringify(payload), callbackName);
}

function agentPicksTextOutput_(json, callbackName) {
  const callback = sanitizeAgentPicksCallback_(callbackName);

  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeAgentPicksCallback_(callbackName) {
  const callback = String(callbackName || "").trim();

  if (!callback) return "";

  // Accept normal JSONP callback paths such as callback123 or window.callback123.
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
    return "";
  }

  return callback;
}
