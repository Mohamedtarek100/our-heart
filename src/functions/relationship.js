/* ============================================================
   Our Heart — Relationship Lock daily experience endpoints
   ------------------------------------------------------------
   GET  /api/relationship/today     — today's question + both users'
                                      recorded answers (no future data)
   POST /api/relationship/answer    — submit MY answer (ownership, day
                                      and duplicate checks all server-side)
   GET  /api/relationship/journey   — the whole waiting journey, grouped
                                      by month, generated from real dates
   GET  /api/relationship/day       — exact recorded answers for ONE past
                                      or current day

   Rules enforced here (never trusted from the client):
   - Identity comes from the trusted session only.
   - A user can answer ONLY the question they own.
   - One answer per user per APPLICATION DAY.
   - The application date is computed by the SERVER in APP_TIMEZONE.
   - Future days never expose answers.
   - Duplicate answers are rejected.
   ============================================================ */

const { app } = require("@azure/functions");
const {
  container,
  serverNow,
  applicationDate,
  parseApplicationDate,
  APP_TIMEZONE,
  DEADLINE_MS,
  QUESTIONS,
  QUESTION_BY_USER,
  questionForUser,
  optionFor,
  requireSession,
  json,
  badRequest,
  unauthorized,
  serverError,
  corsHeaders
} = require("./shared");

/* Cosmos partition key for relationship documents. */
const PARTITION = "relationship";

/* Stable, per-day-per-user document id. Deterministic so a duplicate
   insert hits the same document and is visible as "already answered". */
function answerDocId(date, user) {
  return `answer:${date}:${String(user).toLowerCase()}`;
}

function questionDocId(date, questionId) {
  return `question:${date}:${questionId}`;
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

async function loadAnswersForDate(date) {
  try {
    const { resources } = await container.items
      .query({
        query:
          "SELECT * FROM c WHERE c.type = 'answer' AND c.date = @date",
        parameters: [{ name: "@date", value: date }]
      })
      .fetchAll();
    return resources;
  } catch {
    return [];
  }
}

/* Only the CURRENT day's answer for me — used for the "already answered"
   gate. Deterministic id keeps this a point read. */
async function loadMyAnswer(date, user) {
  try {
    const { resource } = await container
      .item(answerDocId(date, user), PARTITION)
      .read();
    if (!resource || resource.type !== "answer") return null;
    return resource;
  } catch {
    return null;
  }
}

/* Shapes one user's contribution for a given date into a safe payload.
   Answers are only ever included when the user actually answered on
   that date — never inferred, never fabricated. */
function describeAnswer(user, questionId, answers) {
  const question = QUESTIONS[questionId];
  const record = answers.find(
    (answer) => answer.user === user && answer.questionId === questionId
  );

  if (!record || !question) {
    return {
      user,
      questionId,
      answered: false,
      answerId: null,
      answerLabel: null,
      positive: null,
      answeredAt: null
    };
  }

  const option = question.options.find((item) => item.id === record.answerId);

  return {
    user,
    questionId,
    answered: true,
    answerId: record.answerId,
    answerLabel: option ? option.label : null,
    positive: option ? !!option.positive : null,
    answeredAt: Number(record.answeredAt) || null
  };
}

/* Day state used by the Journey. Derived ONLY from server records. */
function describeDay(date, answers, currentDate) {
  const yomna = describeAnswer("Yomna", "yomna", answers);
  const mohamed = describeAnswer("Mohamed", "mohamed", answers);
  const isToday = date === currentDate;
  const isFuture = date > currentDate;

  let state = "unanswered";
  if (yomna.answered && mohamed.answered) state = "complete";
  else if (yomna.answered || mohamed.answered) state = "partial";

  return {
    date,
    isToday,
    isFuture,
    state,
    yomna: isFuture ? null : yomna,
    mohamed: isFuture ? null : mohamed
  };
}

/* ------------------------------------------------------------------ */
/* GET /api/relationship/today                                         */
/* ------------------------------------------------------------------ */

app.http("relationshipToday", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "relationship/today",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    try {
      const date = applicationDate(serverNow());
      const answers = await loadAnswersForDate(date);

      const myQuestion = questionForUser(auth.user);
      const myAnswer = describeAnswer(auth.user, myQuestion?.id, answers);
      const partner = auth.user === "Mohamed" ? "Yomna" : "Mohamed";
      const partnerQuestionId = QUESTION_BY_USER[partner];
      const partnerAnswer = describeAnswer(partner, partnerQuestionId, answers);

      return json(request, 200, {
        success: true,
        serverTime: serverNow(),
        appTimezone: APP_TIMEZONE,
        currentDate: date,
        deadlineMs: Number.isFinite(DEADLINE_MS) ? DEADLINE_MS : null,
        myQuestion: myQuestion
          ? {
            id: myQuestion.id,
            prompt: myQuestion.prompt,
            options: myQuestion.options.map((option) => ({
              id: option.id,
              label: option.label
            }))
          }
          : null,
        myAnswer,
        partner: {
          user: partner,
          answered: partnerAnswer.answered,
          answerLabel: partnerAnswer.answerLabel
        },
        dayState: describeDay(date, answers, date).state
      });
    } catch (error) {
      return serverError(request, context, error, "Unable to load today");
    }
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/relationship/answer                                       */
/* ------------------------------------------------------------------ */

app.http("relationshipAnswer", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "relationship/answer",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const user = auth.user;

    try {
      // 1) The user's question is DETERMINED by the server from the
      //    session — never from the request body.
      const question = questionForUser(user);
      if (!question) return badRequest(request, "No question is assigned to this account");

      // 2) The application date is server-computed.
      const date = applicationDate(serverNow());

      // 3) Parse the requested option id only. Any client-sent questionId,
      //    user, date or owner is ignored on purpose.
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest(request, "Invalid request body");
      }

      const answerId = String(body?.answerId || "").trim();
      const option = optionFor(question.id, answerId);

      if (!answerId || !option) {
        return badRequest(request, "Invalid answer");
      }

      // 4) Duplicate check — deterministic id makes this race-safe.
      const existing = await loadMyAnswer(date, user);
      if (existing) {
        return json(request, 409, {
          success: false,
          error: "You already answered today.",
          code: "ALREADY_ANSWERED",
          date,
          answerId: existing.answerId
        });
      }

      // 5) Persist. The write is keyed by day+user, so a concurrent
      //    duplicate insert fails rather than double-recording.
      const now = serverNow();
      const record = {
        id: answerDocId(date, user),
        type: "answer",
        date,
        user,                       // trusted, from the session
        questionId: question.id,    // trusted, from the server mapping
        answerId: option.id,
        positive: !!option.positive,
        answeredAt: now,
        appTimezone: APP_TIMEZONE
      };

      try {
        await container.items.create(record);
      } catch (error) {
        if (error && (error.code === 409 || error.code === 400)) {
          return json(request, 409, {
            success: false,
            error: "You already answered today.",
            code: "ALREADY_ANSWERED",
            date
          });
        }
        throw error;
      }

      // 6) Return the confirmed record. The frontend only celebrates AFTER
      //    this confirmation arrives.
      const answers = await loadAnswersForDate(date);

      return json(request, 201, {
        success: true,
        confirmed: true,
        date,
        myAnswer: describeAnswer(user, question.id, answers),
        // Whether the celebration should play. Decided SERVER-SIDE from the
        // stored option so the client cannot fabricate a positive answer.
        celebration: option.positive,
        dayState: describeDay(date, answers, date).state,
        serverTime: serverNow()
      });
    } catch (error) {
      return serverError(request, context, error, "Unable to save your answer");
    }
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/relationship/journey                                       */
/* ------------------------------------------------------------------ */

/* Builds the journey from REAL dates between the first recorded answer
   (or today, if there is no history yet) and today. Nothing is hardcoded:
   new days appear automatically, new months appear automatically, and the
   structure stays O(days) with lightweight per-day objects so it scales
   to hundreds or thousands of days.

   Future days are included (soft, non-interactive markers) but NEVER with
   any answer data. */

const MAX_JOURNEY_DAYS = 2200; // ~6 years of safety headroom

function eachDateBetween(startDate, endDate) {
  const dates = [];
  const start = parseApplicationDate(startDate);
  const end = parseApplicationDate(endDate);
  if (!start || !end) return dates;

  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const last = new Date(Date.UTC(end.year, end.month - 1, end.day));

  let guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < MAX_JOURNEY_DAYS) {
    guard += 1;
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function addDays(dateIso, days) {
  const parsed = parseApplicationDate(dateIso);
  if (!parsed) return dateIso;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthKey(dateIso) {
  return String(dateIso).slice(0, 7);
}

app.http("relationshipJourney", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "relationship/journey",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    try {
      const today = applicationDate(serverNow());

      // All recorded answers. Answers are small documents and the couple
      // writes at most two per day, so a single scan is cheap and — more
      // importantly — always complete and authoritative.
      let answers = [];
      try {
        const { resources } = await container.items
          .query("SELECT * FROM c WHERE c.type = 'answer'")
          .fetchAll();
        answers = resources;
      } catch {
        answers = [];
      }

      const answeredDates = answers
        .map((answer) => String(answer.date || ""))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();

      // Journey starts at the very first recorded day (never hardcoded).
      const startDate = answeredDates.length ? answeredDates[0] : today;

      // End at the later of today and the countdown deadline's calendar
      // day, so the path visibly leads toward 25/07/2027.
      const deadlineDate = Number.isFinite(DEADLINE_MS)
        ? applicationDate(DEADLINE_MS)
        : today;
      const endDate = deadlineDate > today ? deadlineDate : today;

      const dates = eachDateBetween(startDate, endDate);

      const byDate = new Map();
      answers.forEach((answer) => {
        const list = byDate.get(String(answer.date)) || [];
        list.push(answer);
        byDate.set(String(answer.date), list);
      });

      const months = [];
      let currentMonth = null;
      let elapsedDays = 0;
      let completedDays = 0;
      let partialDays = 0;

      dates.forEach((date) => {
        const key = monthKey(date);
        if (!currentMonth || currentMonth.key !== key) {
          currentMonth = { key, days: [] };
          months.push(currentMonth);
        }

        const day = describeDay(date, byDate.get(date) || [], today);

        // Counters only consider days up to and including today.
        if (!day.isFuture) {
          elapsedDays += 1;
          if (day.state === "complete") completedDays += 1;
          else if (day.state === "partial") partialDays += 1;
        }

        currentMonth.days.push(day);
      });

      return json(request, 200, {
        success: true,
        currentDate: today,
        appTimezone: APP_TIMEZONE,
        startDate,
        endDate,
        deadlineMs: Number.isFinite(DEADLINE_MS) ? DEADLINE_MS : null,
        totalDays: dates.length,
        progress: {
          elapsedDays,
          completedDays,
          partialDays,
          remainingDays: Math.max(0, dates.length - elapsedDays)
        },
        months
      });
    } catch (error) {
      return serverError(request, context, error, "Unable to load the journey");
    }
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/relationship/day?date=YYYY-MM-DD                           */
/* ------------------------------------------------------------------ */

app.http("relationshipDay", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "relationship/day",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    try {
      const requested = String(request.query.get("date") || "").trim();
      if (!parseApplicationDate(requested)) {
        return badRequest(request, "A valid date is required");
      }

      const today = applicationDate(serverNow());

      // NEVER expose future answers, even for an authenticated user.
      if (requested > today) {
        return json(request, 200, {
          success: true,
          date: requested,
          isFuture: true,
          state: "future",
          yomna: null,
          mohamed: null
        });
      }

      const answers = await loadAnswersForDate(requested);
      const day = describeDay(requested, answers, today);

      return json(request, 200, {
        success: true,
        serverTime: serverNow(),
        appTimezone: APP_TIMEZONE,
        ...day
      });
    } catch (error) {
      return serverError(request, context, error, "Unable to load this day");
    }
  }
});