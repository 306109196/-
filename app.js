const dimensionLabels = [
  { key: "d", name: "决断", en: "WILL" },
  { key: "i", name: "洞察", en: "INSIGHT" },
  { key: "e", name: "表达", en: "VOICE" },
  { key: "r", name: "担当", en: "DUTY" },
];

const scopeLabels = {
  cn: "中国历史人物",
  world: "世界历史人物",
};

const genderLabels = {
  male: "男性优先",
  female: "女性优先",
  any: "不限性别",
};

const state = {
  current: 0,
  questions: [],
  answers: [],
  scores: { d: 0, i: 0, e: 0, r: 0 },
  result: null,
  ranked: [],
  preference: {
    scope: null,
    gender: null,
  },
  locked: false,
  loadingTimer: null,
  toastTimer: null,
};

const views = {
  home: document.querySelector("#home-view"),
  preferences: document.querySelector("#preferences-view"),
  quiz: document.querySelector("#quiz-view"),
  loading: document.querySelector("#loading-view"),
  result: document.querySelector("#result-view"),
};

const guideDialog = document.querySelector("#guide-dialog");
const toast = document.querySelector("#toast");
const preferenceStepOne = document.querySelector("#preference-step-one");
const preferenceStepTwo = document.querySelector("#preference-step-two");
const preferenceStart = document.querySelector(".preference-start");

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    const active = key === name;
    element.hidden = !active;
    element.classList.toggle("is-active", active);
  });
  document.body.dataset.view = name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetQuiz() {
  clearTimeout(state.loadingTimer);
  state.current = 0;
  state.questions = [];
  state.answers = [];
  state.scores = { d: 0, i: 0, e: 0, r: 0 };
  state.result = null;
  state.ranked = [];
  state.locked = false;
  document.querySelector("#loading-meter-fill").style.width = "0%";
}

function resetPreference() {
  state.preference = { scope: null, gender: null };
  document.querySelectorAll("[data-scope]").forEach((button) => {
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
  });
  document.querySelectorAll("[data-gender]").forEach((button) => {
    button.classList.remove("is-selected");
    button.setAttribute("aria-checked", "false");
  });
  preferenceStart.disabled = true;
  preferenceStepOne.hidden = false;
  preferenceStepOne.classList.add("is-active");
  preferenceStepTwo.hidden = true;
  preferenceStepTwo.classList.remove("is-active");
  document.querySelector("#preference-step-label").textContent = "STEP 01 / 02";
  document.querySelector("#preference-progress-fill").style.width = "50%";
  document.querySelector("#selected-scope-label").textContent = "尚未选择";
  document.querySelector("#preference-summary-text").textContent = "完成映射偏好设置";
  document.querySelector("#preference-candidate-count").textContent = "0";
}

function openPreferences() {
  if (guideDialog.open) guideDialog.close();
  resetQuiz();
  resetPreference();
  showView("preferences");
}

function goHome() {
  resetQuiz();
  resetPreference();
  showView("home");
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2800);
}

function openGuide() {
  if (!guideDialog.open) guideDialog.showModal();
}

function filteredFigures(scope = state.preference.scope, gender = state.preference.gender) {
  if (!scope) return [];
  const scopeFigures = FIGURE_CATALOG.filter((figure) => figure.scope === scope);
  if (!gender || gender === "any") return scopeFigures;
  const preferred = scopeFigures.filter((figure) => figure.gender === gender);
  return preferred.length ? preferred : scopeFigures;
}

function chooseScope(scope) {
  state.preference.scope = scope;
  state.preference.gender = null;

  document.querySelectorAll("[data-scope]").forEach((button) => {
    const selected = button.dataset.scope === scope;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-gender]").forEach((button) => {
    button.classList.remove("is-selected");
    button.setAttribute("aria-checked", "false");
  });

  document.querySelector("#selected-scope-label").textContent = scopeLabels[scope];
  document.querySelector("#preference-step-label").textContent = "STEP 02 / 02";
  document.querySelector("#preference-progress-fill").style.width = "100%";
  document.querySelector("#preference-summary-text").textContent = `请选择${scopeLabels[scope]}的镜像性别偏好`;
  document.querySelector("#preference-candidate-count").textContent = String(filteredFigures(scope, "any").length);
  preferenceStart.disabled = true;

  preferenceStepOne.hidden = true;
  preferenceStepOne.classList.remove("is-active");
  preferenceStepTwo.hidden = false;
  window.requestAnimationFrame(() => {
    preferenceStepTwo.classList.add("is-active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function chooseGender(gender) {
  if (!state.preference.scope) return;
  state.preference.gender = gender;

  document.querySelectorAll("[data-gender]").forEach((button) => {
    const selected = button.dataset.gender === gender;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });

  const count = filteredFigures(state.preference.scope, gender).length;
  document.querySelector("#preference-summary-text").textContent =
    `${scopeLabels[state.preference.scope]}中${genderLabels[gender]}匹配`;
  document.querySelector("#preference-candidate-count").textContent = String(count);
  preferenceStart.disabled = false;
}

function preferenceBack() {
  preferenceStepTwo.hidden = true;
  preferenceStepTwo.classList.remove("is-active");
  preferenceStepOne.hidden = false;
  preferenceStepOne.classList.add("is-active");
  document.querySelector("#preference-step-label").textContent = "STEP 01 / 02";
  document.querySelector("#preference-progress-fill").style.width = "50%";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startQuiz() {
  if (!state.preference.scope || !state.preference.gender) return;
  resetQuiz();
  state.questions = selectQuestionSet(24);
  showView("quiz");
  renderQuestion();
}

function questionScores(option) {
  return TAG_SCORES[option.tag] || { d: 0, i: 0, e: 0, r: 0 };
}

function calculateScores() {
  const raw = { d: 0, i: 0, e: 0, r: 0 };
  state.answers.forEach((optionIndex, questionIndex) => {
    const scores = questionScores(state.questions[questionIndex].options[optionIndex]);
    Object.keys(raw).forEach((key) => {
      raw[key] += scores[key] || 0;
    });
  });

  const ranges = {};
  Object.keys(raw).forEach((key) => {
    let minimum = 0;
    let maximum = 0;
    state.questions.forEach((question) => {
      const values = question.options.map((option) => questionScores(option)[key] || 0);
      minimum += Math.min(...values);
      maximum += Math.max(...values);
    });
    ranges[key] = { minimum, maximum };
  });

  const normalized = {};
  Object.keys(raw).forEach((key) => {
    const { minimum, maximum } = ranges[key];
    const span = Math.max(1, maximum - minimum);
    normalized[key] = Math.round(clamp(22 + ((raw[key] - minimum) / span) * 74, 22, 98));
  });

  state.scores = normalized;
  return normalized;
}

function rankFigures(scores, scope = state.preference.scope, gender = state.preference.gender) {
  const candidates = filteredFigures(scope, gender);
  const userValues = dimensionLabels.map(({ key }) => scores[key]);
  const userMean = userValues.reduce((sum, value) => sum + value, 0) / userValues.length;

  return candidates
    .map((figure) => {
      const figureValues = dimensionLabels.map(({ key }) => figure.profile[key]);
      const figureMean = figureValues.reduce((sum, value) => sum + value, 0) / figureValues.length;
      let dot = 0;
      let userMagnitude = 0;
      let figureMagnitude = 0;
      let absoluteDifference = 0;

      for (let index = 0; index < userValues.length; index += 1) {
        const userCentered = userValues[index] - userMean;
        const figureCentered = figureValues[index] - figureMean;
        dot += userCentered * figureCentered;
        userMagnitude += userCentered * userCentered;
        figureMagnitude += figureCentered * figureCentered;
        absoluteDifference += Math.abs(userValues[index] - figureValues[index]);
      }

      const correlation = dot / Math.sqrt(Math.max(1, userMagnitude * figureMagnitude));
      const closeness = 1 - absoluteDifference / 400;
      const fit = correlation * 0.55 + closeness * 0.45;
      const affinity = Math.round(clamp(78 + fit * 20, 76, 97));
      return { ...figure, affinity };
    })
    .sort((a, b) => b.affinity - a.affinity);
}

function renderQuestion() {
  const question = state.questions[state.current];
  state.locked = false;
  const percent = Math.round(((state.current + 1) / state.questions.length) * 100);

  document.querySelector("#question-current").textContent = String(state.current + 1).padStart(2, "0");
  document.querySelector("#question-percent").textContent = `${percent}%`;
  document.querySelector("#quiz-theme").textContent = question.theme;
  document.querySelector("#question-progress-fill").style.width = `${percent}%`;
  document.querySelector("#question-kicker").textContent = question.theme;
  document.querySelector("#question-title").textContent = question.title;
  document.querySelector("#question-context").textContent = question.context;
  document.querySelector("#question-back").disabled = state.current === 0;

  const answerList = document.querySelector("#answer-list");
  answerList.innerHTML = "";

  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-button";
    button.dataset.optionIndex = String(index);
    button.classList.toggle("is-selected", state.answers[state.current] === index);
    button.innerHTML = `
      <span class="answer-key">${String.fromCharCode(65 + index)}</span>
      <span class="answer-copy">
        <span class="answer-text">${option.text}</span>
        <span class="answer-tag">更偏「${option.tag}」的行为倾向</span>
      </span>
      <svg class="answer-arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14"></path>
        <path d="m14 7 5 5-5 5"></path>
      </svg>
    `;
    button.addEventListener("click", () => selectAnswer(index));
    answerList.appendChild(button);
  });

  document.querySelector(".question-content").style.animation = "none";
  window.requestAnimationFrame(() => {
    document.querySelector(".question-content").style.animation = "";
  });

  updateDimensionPreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateDimensionPreview() {
  const answered = state.answers.filter((answer) => Number.isInteger(answer));
  const partial = { d: 0, i: 0, e: 0, r: 0 };
  answered.forEach((optionIndex, questionIndex) => {
    const scores = questionScores(state.questions[questionIndex].options[optionIndex]);
    Object.keys(partial).forEach((key) => {
      partial[key] += scores[key] || 0;
    });
  });

  const total = Math.max(1, answered.length);
  document.querySelectorAll(".quiz-dimensions > div").forEach((element) => {
    const key = element.dataset.dimension;
    const percentage = answered.length ? clamp(25 + (partial[key] / total) * 12, 12, 88) : 50;
    element.querySelector("b").style.width = `${percentage}%`;
  });
}

function selectAnswer(optionIndex) {
  if (state.locked) return;
  state.locked = true;
  state.answers[state.current] = optionIndex;

  const buttons = [...document.querySelectorAll(".answer-button")];
  buttons.forEach((button, index) => {
    button.classList.toggle("is-selected", index === optionIndex);
    button.disabled = true;
  });
  updateDimensionPreview();

  window.setTimeout(() => {
    if (state.current < state.questions.length - 1) {
      state.current += 1;
      renderQuestion();
    } else {
      startAnalysis();
    }
  }, 310);
}

function goBack() {
  if (state.current === 0 || state.locked) return;
  state.current -= 1;
  renderQuestion();
}

function startAnalysis() {
  showView("loading");
  state.answers = state.answers.slice(0, state.questions.length);
  const scores = calculateScores();
  state.ranked = rankFigures(scores);
  state.result = state.ranked[0];

  const statuses = [
    "建立你的四维人格坐标...",
    "检索行为倾向的历史回声...",
    `比对${scopeLabels[state.preference.scope]}中的候选人物...`,
    "正在生成你的照见档案...",
  ];
  const fill = document.querySelector("#loading-meter-fill");
  const status = document.querySelector("#loading-status");
  let index = 0;

  fill.style.width = "8%";
  status.textContent = statuses[0];

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const interval = reducedMotion ? 160 : 610;

  state.loadingTimer = window.setInterval(() => {
    index += 1;
    if (index < statuses.length) {
      status.textContent = statuses[index];
      fill.style.width = `${(index + 1) * 22}%`;
    }
    if (index >= statuses.length) {
      clearInterval(state.loadingTimer);
      fill.style.width = "100%";
      window.setTimeout(() => {
        renderResult();
        showView("result");
      }, reducedMotion ? 80 : 360);
    }
  }, interval);
}

function renderResult() {
  const result = state.result;
  if (!result) return;

  const nameElement = document.querySelector("#result-name");
  nameElement.textContent = result.name;
  nameElement.classList.toggle("is-long", result.name.length >= 6);
  nameElement.classList.toggle("is-very-long", result.name.length >= 8);
  document.querySelector(".result-hero").classList.toggle("has-long-name", result.name.length >= 6);

  const now = new Date();
  document.querySelector("#result-date").textContent =
    `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")} · 档案编号 ${String(Math.floor(now.getTime() / 1000)).slice(-5)}`;
  document.querySelector("#match-score").textContent = result.affinity;
  document.querySelector("#result-archetype").textContent = result.archetype;
  document.querySelector("#result-era").textContent = result.era;
  document.querySelector("#result-preference").textContent =
    `匹配范围：${scopeLabels[result.scope]} · ${genderLabels[state.preference.gender] || "不限性别"}`;
  document.querySelector("#result-quote").textContent = result.quote;
  document.querySelector("#result-seal").textContent = result.seal;
  document.querySelector("#result-summary").textContent = result.summary;
  document.querySelector("#result-similarity").textContent = result.similarity;
  document.querySelector("#result-blindspot").textContent = result.blindspot;

  document.querySelector("#result-tags").innerHTML = result.tags.map((tag) => `<span>${tag}</span>`).join("");
  document.querySelector("#result-strengths").innerHTML =
    result.strengths.map((strength) => `<li>${strength}</li>`).join("");

  renderScores();
  renderRadar();
  renderKindred(result);
}

function renderScores() {
  const scoreList = document.querySelector("#score-list");
  scoreList.innerHTML = dimensionLabels
    .map(
      ({ key, name, en }) => `
        <div class="score-row">
          <span>${name}</span>
          <i class="score-track"><i data-score-fill="${key}" style="width: 0%"></i></i>
          <small>${state.scores[key]}</small>
          <span class="sr-only">${en}</span>
        </div>
      `,
    )
    .join("");

  window.requestAnimationFrame(() => {
    dimensionLabels.forEach(({ key }) => {
      const fill = scoreList.querySelector(`[data-score-fill="${key}"]`);
      if (fill) fill.style.width = `${state.scores[key]}%`;
    });
  });
}

function radarPoints(scores) {
  const center = { x: 140, y: 124 };
  const radii = 100;
  const coordinates = [
    { value: scores.i, angle: -90 },
    { value: scores.e, angle: 0 },
    { value: scores.r, angle: 90 },
    { value: scores.d, angle: 180 },
  ];
  return coordinates
    .map(({ value, angle }) => {
      const ratio = value / 100;
      const radians = (angle * Math.PI) / 180;
      return `${(center.x + Math.cos(radians) * radii * ratio).toFixed(1)},${(center.y + Math.sin(radians) * radii * ratio).toFixed(1)}`;
    })
    .join(" ");
}

function renderRadar() {
  document.querySelector("#radar-fill").setAttribute("points", radarPoints(state.scores));
  document.querySelector("#radar-points").innerHTML = radarPoints(state.scores)
    .split(" ")
    .map((point) => {
      const [x, y] = point.split(",");
      return `<circle cx="${x}" cy="${y}" r="3"></circle>`;
    })
    .join("");
}

function renderKindred(result) {
  const eligible = filteredFigures(result.scope, state.preference.gender);
  const named = result.kindred
    .map((name) => eligible.find((figure) => figure.name === name))
    .filter(Boolean);
  const rankedRest = state.ranked.filter((figure) => figure.id !== result.id);
  const unique = [...named, ...rankedRest].filter(
    (figure, index, collection) => collection.findIndex((item) => item.id === figure.id) === index,
  );

  document.querySelector("#kindred-list").innerHTML = unique
    .slice(0, 2)
    .map(
      (figure) => `
        <div class="kindred-item">
          <span class="kindred-seal">${figure.seal}</span>
          <div class="kindred-copy">
            <strong>${figure.name}</strong>
            <span>${figure.archetype}</span>
          </div>
          <span class="kindred-affinity">${figure.affinity}<small>%</small></span>
        </div>
      `,
    )
    .join("");
}

function wrapCanvasText(context, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const char of text) {
    const candidate = line + char;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createArchiveCard() {
  const result = state.result;
  if (!result) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const context = canvas.getContext("2d");
  const paper = "#f4f1e9";
  const ink = "#191823";
  const violet = "#6d5bc8";
  const cinnabar = "#c9543b";

  context.fillStyle = paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ddd7f5";
  context.fillRect(0, 0, 1080, 300);
  context.fillStyle = "rgba(25,24,35,0.1)";
  context.fillRect(78, 58, 924, 1);
  context.fillRect(78, 1380, 924, 1);

  context.fillStyle = ink;
  context.font = '22px "Microsoft YaHei", sans-serif';
  context.fillText("照见 · THE INNER ARCHIVE", 78, 106);
  context.font = '18px "Microsoft YaHei", sans-serif';
  context.fillStyle = "rgba(25,24,35,0.56)";
  context.fillText("一份以中外历史人物为镜像的人格档案", 78, 142);
  context.textAlign = "right";
  context.fillText(`NO. ${String(Date.now()).slice(-6)}`, 1002, 106);
  context.textAlign = "left";

  context.fillStyle = cinnabar;
  context.fillRect(78, 232, 72, 72);
  context.fillStyle = paper;
  context.font = '48px "KaiTi", "SimSun", serif';
  context.fillText(result.seal, 98, 283);

  context.fillStyle = ink;
  context.font = '22px "Microsoft YaHei", sans-serif';
  context.fillText("你的历史镜像", 178, 254);
  const nameFontSize = result.name.length >= 8 ? 54 : result.name.length >= 6 ? 68 : 100;
  context.font = `bold ${nameFontSize}px "KaiTi", "SimSun", serif`;
  context.fillText(result.name, 174, 336);

  context.textAlign = "right";
  context.fillStyle = violet;
  context.font = '64px "SimSun", serif';
  context.fillText(`${result.affinity}%`, 1002, 322);
  context.fillStyle = "rgba(25,24,35,0.48)";
  context.font = '18px "Microsoft YaHei", sans-serif';
  context.fillText("精神相似度", 1002, 352);
  context.textAlign = "left";

  context.strokeStyle = "rgba(25,24,35,0.24)";
  context.beginPath();
  context.moveTo(78, 394);
  context.lineTo(1002, 394);
  context.stroke();

  context.fillStyle = cinnabar;
  context.font = '28px "SimSun", serif';
  context.fillText(result.archetype, 78, 456);
  context.fillStyle = "rgba(25,24,35,0.52)";
  context.font = '18px "Microsoft YaHei", sans-serif';
  context.fillText(result.era, 78, 490);
  context.fillText(
    `匹配范围：${scopeLabels[result.scope]} · ${genderLabels[state.preference.gender] || "不限性别"}`,
    78,
    520,
  );
  context.fillStyle = "rgba(25,24,35,0.76)";
  context.font = '28px "SimSun", serif';
  context.fillText(result.quote, 78, 570);

  context.fillStyle = ink;
  context.font = '28px "Microsoft YaHei", sans-serif';
  context.fillText("你的精神侧写", 78, 640);
  context.fillStyle = "rgba(25,24,35,0.72)";
  context.font = '24px "SimSun", serif';
  wrapCanvasText(context, result.summary, 900)
    .slice(0, 5)
    .forEach((line, index) => context.fillText(line, 78, 688 + index * 42));

  context.fillStyle = "rgba(25,24,35,0.24)";
  context.fillRect(78, 918, 924, 1);
  context.fillStyle = ink;
  context.font = '26px "Microsoft YaHei", sans-serif';
  context.fillText("四维人格坐标", 78, 970);

  dimensionLabels.forEach(({ key, name }, index) => {
    const y = 1020 + index * 62;
    const value = state.scores[key];
    context.fillStyle = ink;
    context.font = '22px "SimSun", serif';
    context.fillText(name, 78, y + 8);
    context.fillStyle = "rgba(25,24,35,0.12)";
    context.fillRect(165, y, 620, 4);
    context.fillStyle = violet;
    context.fillRect(165, y, 620 * (value / 100), 4);
    context.fillStyle = "rgba(25,24,35,0.54)";
    context.font = '20px "SimSun", serif';
    context.textAlign = "right";
    context.fillText(String(value), 1002, y + 8);
    context.textAlign = "left";
  });

  context.fillStyle = "rgba(25,24,35,0.24)";
  context.fillRect(78, 1260, 924, 1);
  context.fillStyle = cinnabar;
  context.font = '20px "Microsoft YaHei", sans-serif';
  context.fillText("以古为镜，见自己", 78, 1310);
  context.fillStyle = "rgba(25,24,35,0.46)";
  context.font = '17px "Microsoft YaHei", sans-serif';
  context.fillText("人格测试用于自我观察与娱乐，不构成心理诊断", 78, 1342);
  context.strokeStyle = "rgba(25,24,35,0.3)";
  context.strokeRect(39, 39, 1002, 1362);

  return canvas;
}

function downloadArchiveCard() {
  const canvas = createArchiveCard();
  if (!canvas) return;

  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("档案卡生成失败，请重试");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `照见-${state.result.name}-人格档案.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("档案卡已生成");
  }, "image/png");
}

function resultShareLine() {
  return dimensionLabels.map(({ key, name }) => `${name} ${state.scores[key]}`).join(" · ");
}

async function shareResult() {
  const result = state.result;
  const text = [
    `我在「照见」遇见的历史镜像是：${result.name}`,
    `人格类型：${result.archetype}`,
    `匹配范围：${scopeLabels[result.scope]} · ${genderLabels[state.preference.gender] || "不限性别"}`,
    `精神相似度：${result.affinity}%`,
    resultShareLine(),
    "以古为镜，见自己。",
  ].join("\n");

  const canvas = createArchiveCard();
  const blob = canvas
    ? await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/png");
      })
    : null;

  if (blob && navigator.share && navigator.canShare) {
    const file = new File([blob], `照见-${result.name}.png`, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: `我与${result.name}相似`, text, files: [file] });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("分享文案已复制，可粘贴到小红书");
  } catch (error) {
    showToast("长按页面内容即可复制分享");
  }
}

document.addEventListener("click", (event) => {
  const scopeTarget = event.target.closest("[data-scope]");
  if (scopeTarget) {
    chooseScope(scopeTarget.dataset.scope);
    return;
  }

  const genderTarget = event.target.closest("[data-gender]");
  if (genderTarget) {
    chooseGender(genderTarget.dataset.gender);
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const { action } = actionTarget.dataset;

  if (action === "start") openPreferences();
  if (action === "home") goHome();
  if (action === "guide") openGuide();
  if (action === "close-guide") guideDialog.close();
  if (action === "preference-back") preferenceBack();
  if (action === "begin-quiz") startQuiz();
  if (action === "back") goBack();
  if (action === "restart") openPreferences();
  if (action === "download") downloadArchiveCard();
  if (action === "share") shareResult();
  if (action === "logout") {
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(() => {
      window.location.replace("/");
    });
  }
});

guideDialog.addEventListener("click", (event) => {
  if (event.target === guideDialog) {
    const rect = guideDialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) guideDialog.close();
  }
});

document.addEventListener("keydown", (event) => {
  if (document.body.dataset.view !== "quiz" || guideDialog.open) return;
  const keyIndex = ["a", "b", "c", "d"].indexOf(event.key.toLowerCase());
  if (keyIndex !== -1) {
    event.preventDefault();
    selectAnswer(keyIndex);
  }
  if (event.key === "ArrowLeft") goBack();
});

function applyPreviewFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") !== "result") return;

  const previewName = params.get("figure") || "sushi";
  const selected =
    FIGURE_CATALOG.find((figure) => figure.id === previewName) ||
    FIGURE_CATALOG.find((figure) => figure.name === previewName) ||
    FIGURE_CATALOG.find((figure) => figure.id === "sushi");
  const requestedScope = params.get("scope");
  const requestedGender = params.get("gender");

  state.preference.scope = requestedScope === "world" || requestedScope === "cn" ? requestedScope : selected.scope;
  state.preference.gender =
    requestedGender === "male" || requestedGender === "female"
      ? requestedGender
      : requestedGender === "any"
        ? "any"
        : selected.gender;
  state.scores = { ...selected.profile };
  state.ranked = rankFigures(state.scores);
  state.result = {
    ...selected,
    affinity: state.ranked.find((figure) => figure.id === selected.id)?.affinity || 94,
  };
  renderResult();
  showView("result");
}

resetPreference();
applyPreviewFromQuery();
