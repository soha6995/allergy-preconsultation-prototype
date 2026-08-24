/**
 * Stage scaling + screen flow controller.
 *
 * All screens share the same 137 x 147 coordinate system pulled from the
 * Figma frame ("onboarding", node 163:2). To add a new screen later:
 *   1. Add its markup as <section class="screen" data-screen="...">…</section>
 *      inside #stage in index.html, positioned with the same px values Figma
 *      reports (no rescaling needed by hand — #stage itself is scaled).
 *   2. Add its id to SCREEN_FLOW below in the right order.
 *   3. Any element with [data-next] inside a screen will advance to that
 *      screen id on click (or to the next id in SCREEN_FLOW if data-next is
 *      left empty).
 */

const STAGE_WIDTH = 137;
const STAGE_HEIGHT = 147;
const MAX_STAGE_WIDTH = 430; // caps how large the mobile screen renders on wide desktops

const SCREEN_FLOW = [
  "onboarding-1",
  "onboarding-2",
  "onboarding-3",
  "onboarding-4",
  "onboarding-5",
  "text-size-control",
  "patient-id",
  "image-upload",
  "chat",
  "done",
];

function fitStage() {
  const viewport = document.getElementById("app-viewport");
  const stage = document.getElementById("stage");
  if (!viewport || !stage) return;

  const computed = getComputedStyle(viewport);
  const paddingX = parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight);
  const paddingY = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);

  const availableWidth = viewport.clientWidth - paddingX;
  const availableHeight = viewport.clientHeight - paddingY;

  const maxScale = MAX_STAGE_WIDTH / STAGE_WIDTH;
  const scale = Math.min(availableWidth / STAGE_WIDTH, availableHeight / STAGE_HEIGHT, maxScale);

  stage.style.transform = `scale(${scale})`;
}

function initProgressDots() {
  document.querySelectorAll(".ob-progress[data-active-dot]").forEach((group) => {
    const activeIndex = parseInt(group.dataset.activeDot, 10);
    const dots = group.querySelectorAll(".ob-progress__dot");
    dots.forEach((dot, i) => dot.classList.toggle("is-active", i + 1 === activeIndex));
  });
}

function goToScreen(screenId) {
  const target = document.querySelector(`.screen[data-screen="${screenId}"]`);

  if (!target) {
    console.info(
      `[화면 전환] "${screenId}" 화면은 아직 구현되지 않았습니다. 추가되는 대로 자동으로 연결됩니다.`
    );
    return false;
  }

  document.querySelectorAll(".screen.is-active").forEach((el) => el.classList.remove("is-active"));
  target.classList.add("is-active");
  syncPatientIdTextSizeButtons(); // reflect the current --text-scale in case it changed since load
  syncImageUploadPatientId(); // carry the Patient ID typed in step 1 over to step 2's/step 3's readout
  if (screenId === "chat") openChatGuideModalOnce();
  return true;
}

function getNextScreenId(currentId) {
  const index = SCREEN_FLOW.indexOf(currentId);
  if (index === -1 || index === SCREEN_FLOW.length - 1) return null;
  return SCREEN_FLOW[index + 1];
}

function initNextButtons() {
  document.querySelectorAll("[data-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const currentScreen = button.closest(".screen");
      const currentId = currentScreen ? currentScreen.dataset.screen : null;
      const explicitNext = button.dataset.next;
      const nextId = explicitNext || (currentId ? getNextScreenId(currentId) : null);

      if (nextId) goToScreen(nextId);
    });
  });
}

/**
 * Consent gates: any element marked [data-consent-gate] keeps its own
 * [data-next] button disabled until every checkbox inside it is checked.
 * Re-checked on every change, so unchecking one after all three were
 * checked immediately disables the button again. Reusable as-is for any
 * future screen that needs the same "check everything to continue" gate.
 */
function initConsentGates() {
  document.querySelectorAll("[data-consent-gate]").forEach((gate) => {
    const checkboxes = gate.querySelectorAll('input[type="checkbox"]');
    const button = gate.querySelector("[data-next]");
    if (!button || checkboxes.length === 0) return;

    const updateButtonState = () => {
      const allChecked = Array.from(checkboxes).every((checkbox) => checkbox.checked);
      button.disabled = !allChecked;
    };

    checkboxes.forEach((checkbox) => checkbox.addEventListener("change", updateButtonState));
    updateButtonState();
  });
}

/**
 * Tracks input modality so CSS can show focus rings only for real keyboard
 * navigation. Browsers' own :focus-visible heuristic still marks a mouse
 * click on a checkbox/radio as "visible" focus, which is why relying on
 * :focus-visible alone wasn't enough to hide the ring on click.
 */
function initKeyboardFocusTracking() {
  const root = document.documentElement;
  window.addEventListener("keydown", (event) => {
    if (event.key === "Tab") root.classList.add("is-keyboard-nav");
  });
  window.addEventListener("mousedown", () => root.classList.remove("is-keyboard-nav"));
}

const PATIENT_ID_PATTERN = /^P\d{4}$/;

/**
 * Patient-id screen: keeps the "다음" button's real `disabled` state, its
 * color, and the Patient ID readout above the step row all in sync with
 * the input's current value. The button only enables once the value fully
 * matches the P + 4-digit format (e.g. "P0001") — invalid or partial input
 * keeps it disabled. The readout mirrors the raw value regardless of
 * validity so the user can see what they've typed.
 */
function initPatientIdScreen() {
  const screen = document.querySelector("[data-patient-id-screen]");
  if (!screen) return;

  const input = screen.querySelector(".pid-input");
  const button = screen.querySelector(".pid-next");
  const display = screen.querySelector(".pid-display");
  if (!input || !button) return;

  const sync = () => {
    const value = input.value.trim();
    button.disabled = !PATIENT_ID_PATTERN.test(value);
    if (display) display.textContent = value;
  };

  input.addEventListener("input", sync);
  sync();
}

/**
 * Global text-size scale: persisted so it survives across screens (and
 * page reloads) and applied via a single --text-scale CSS variable on
 * <html> rather than transforming/zooming anything. Only font-size rules
 * that opt in via calc(Npx * var(--text-scale, 1)) respond to it — icons,
 * cards, buttons, inputs, and footers stay their fixed Figma size.
 * Two places write to this: the text-size-control screen's radio cards
 * (the primary entry point) and the patient-id footer's quick toggle
 * (kept for direct access on that screen) — both go through the same
 * setTextScale()/TEXT_SCALE_STORAGE_KEY so they can't drift out of sync.
 */
const TEXT_SCALE_STORAGE_KEY = "allergydoc:textScale";

function getStoredTextScale() {
  try {
    return localStorage.getItem(TEXT_SCALE_STORAGE_KEY) === "1.25" ? "1.25" : "1";
  } catch (error) {
    return "1"; // e.g. localStorage blocked (private browsing, sandboxed iframe)
  }
}

function setTextScale(scale) {
  document.documentElement.style.setProperty("--text-scale", scale);
  try {
    localStorage.setItem(TEXT_SCALE_STORAGE_KEY, scale);
  } catch (error) {
    // Non-fatal: the CSS variable above still applies for the rest of this
    // session even if persistence across reloads isn't available.
  }
}

function initGlobalTextScale() {
  setTextScale(getStoredTextScale());
}

/**
 * text-size-control screen: two native radio inputs (name="text-size-choice")
 * give real mutual-exclusion and keyboard support for free. CSS handles the
 * selected-state border/dot/label-color reactively via :has(:checked); this
 * just enables the CTA and persists the chosen scale on every change.
 */
function initTextSizeControlScreen() {
  const screen = document.querySelector('[data-screen="text-size-control"]');
  if (!screen) return;

  const radios = screen.querySelectorAll(".tsc-radio__input");
  const button = screen.querySelector(".tsc-next");
  if (!button || radios.length === 0) return;

  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      setTextScale(radio.value);
      button.disabled = false;
    });
  });
}

/**
 * Reflects whichever scale is currently in effect on every 작게/크게 footer
 * control on the page (patient-id, image-upload, and any later screen that
 * reuses the same .pid-textsize markup) without changing it. Called once
 * at init and again by goToScreen() every time a screen is shown, since
 * the scale can change on a screen whose footer isn't visible right now.
 */
function syncPatientIdTextSizeButtons() {
  document.querySelectorAll(".pid-textsize").forEach((footer) => {
    const smallButton = footer.querySelector(".pid-textsize__btn--small");
    const largeButton = footer.querySelector(".pid-textsize__btn--large");
    const smallLabel = footer.querySelector(".pid-textsize__label--small");
    const largeLabel = footer.querySelector(".pid-textsize__label--large");
    if (!smallButton || !largeButton) return;

    const isLarge = getStoredTextScale() === "1.25";
    smallButton.classList.toggle("is-active", !isLarge);
    smallLabel.classList.toggle("is-active", !isLarge);
    largeButton.classList.toggle("is-active", isLarge);
    largeLabel.classList.toggle("is-active", isLarge);
  });
}

/**
 * Text Size control footer(s) — one per screen that has this control.
 * Every instance writes through the same setTextScale(), so they can
 * never drift out of sync with each other or with the text-size-control
 * screen's radio cards.
 */
function initPatientIdTextSizeControl() {
  document.querySelectorAll(".pid-textsize").forEach((footer) => {
    const smallButton = footer.querySelector(".pid-textsize__btn--small");
    const largeButton = footer.querySelector(".pid-textsize__btn--large");
    const smallLabel = footer.querySelector(".pid-textsize__label--small");
    const largeLabel = footer.querySelector(".pid-textsize__label--large");
    if (!smallButton || !largeButton) return;

    const selectSmall = () => {
      setTextScale("1");
      syncPatientIdTextSizeButtons();
    };
    const selectLarge = () => {
      setTextScale("1.25");
      syncPatientIdTextSizeButtons();
    };

    smallButton.addEventListener("click", selectSmall);
    smallLabel.addEventListener("click", selectSmall);
    largeButton.addEventListener("click", selectLarge);
    largeLabel.addEventListener("click", selectLarge);
  });

  syncPatientIdTextSizeButtons();
}

/**
 * Image-upload screen: Patient ID readout, thumbnail grid, camera/file
 * pickers, "증상 사진이 없습니다" checkbox, and the 다음 button's gated
 * disabled state all live here. Uses browser-memory object URLs only —
 * no server upload in this prototype.
 */
const IMAGE_UPLOAD_MAX_PHOTOS = 5;
const IMAGE_UPLOAD_ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const IMAGE_UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
let imageUploadPhotos = []; // { id, objectUrl }

function syncImageUploadPatientId() {
  const source = document.querySelector(".pid-input");
  if (!source) return;
  const value = source.value.trim();
  document.querySelectorAll(".iu-display, .chat-display, .done-display, .survey-display").forEach((display) => {
    display.textContent = value;
  });
}

function initImageUploadScreen() {
  const screen = document.querySelector('[data-screen="image-upload"]');
  if (!screen) return;

  const fileInput = screen.querySelector(".iu-file-input");
  const cameraInput = screen.querySelector(".iu-camera-input");
  const thumbsContainer = screen.querySelector(".iu-thumbs");
  const emptyState = screen.querySelector(".iu-empty-state");
  const counter = screen.querySelector(".iu-counter");
  const noPhotoCheckbox = screen.querySelector(".iu-no-photo__input");
  const nextButton = screen.querySelector(".iu-next");
  const cameraButton = screen.querySelector(".iu-camera-trigger");
  const fileButton = screen.querySelector(".iu-file-trigger");

  const renderThumbs = () => {
    thumbsContainer.innerHTML = "";
    imageUploadPhotos.forEach((photo) => {
      const figure = document.createElement("figure");
      figure.className = "iu-thumb";

      const img = document.createElement("img");
      img.src = photo.objectUrl;
      img.alt = "업로드한 증상 사진";
      figure.appendChild(img);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "iu-thumb__remove";
      removeButton.textContent = "×"; // × — plain glyph, no icon asset
      removeButton.setAttribute("aria-label", "사진 삭제");
      removeButton.addEventListener("click", () => removePhoto(photo.id));
      figure.appendChild(removeButton);

      thumbsContainer.appendChild(figure);
    });
  };

  const updateUI = () => {
    const count = imageUploadPhotos.length;
    const atMax = count >= IMAGE_UPLOAD_MAX_PHOTOS;

    counter.textContent = `${count} / ${IMAGE_UPLOAD_MAX_PHOTOS} 장`;
    emptyState.style.display = count === 0 ? "flex" : "none";
    thumbsContainer.style.display = count === 0 ? "none" : "flex";

    cameraButton.disabled = atMax;
    fileButton.disabled = atMax;

    if (count > 0 && noPhotoCheckbox.checked) {
      noPhotoCheckbox.checked = false; // uploading photos supersedes "no photo"
    }

    nextButton.disabled = !(count > 0 || noPhotoCheckbox.checked);
    renderThumbs();
  };

  const addFiles = (fileList) => {
    const remainingSlots = IMAGE_UPLOAD_MAX_PHOTOS - imageUploadPhotos.length;
    if (remainingSlots <= 0) return;

    const files = Array.from(fileList).slice(0, remainingSlots);
    const rejected = [];

    files.forEach((file) => {
      if (!IMAGE_UPLOAD_ACCEPTED_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (지원하지 않는 형식)`);
        return;
      }
      if (file.size > IMAGE_UPLOAD_MAX_FILE_SIZE) {
        rejected.push(`${file.name} (10MB 초과)`);
        return;
      }
      imageUploadPhotos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        objectUrl: URL.createObjectURL(file),
      });
    });

    if (rejected.length > 0) {
      alert(`다음 파일은 업로드할 수 없습니다:\n${rejected.join("\n")}`);
    }

    updateUI();
  };

  function removePhoto(id) {
    const index = imageUploadPhotos.findIndex((photo) => photo.id === id);
    if (index === -1) return;
    URL.revokeObjectURL(imageUploadPhotos[index].objectUrl);
    imageUploadPhotos.splice(index, 1);
    updateUI();
  }

  fileInput.addEventListener("change", (event) => {
    addFiles(event.target.files);
    event.target.value = ""; // allow re-selecting the same file later
  });
  cameraInput.addEventListener("change", (event) => {
    addFiles(event.target.files);
    event.target.value = "";
  });
  cameraButton.addEventListener("click", () => cameraInput.click());
  fileButton.addEventListener("click", () => fileInput.click());

  noPhotoCheckbox.addEventListener("change", () => {
    if (noPhotoCheckbox.checked && imageUploadPhotos.length > 0) {
      noPhotoCheckbox.checked = false;
      alert("업로드된 사진을 모두 삭제한 후 선택할 수 있습니다.");
      return;
    }
    nextButton.disabled = !(imageUploadPhotos.length > 0 || noPhotoCheckbox.checked);
  });

  updateUI();
}

/**
 * Step 3 chat screen's onboarding/guide popup. GUIDE_STEPS is the only
 * thing a new guide needs: push its content object here and the existing
 * modal markup re-renders from whichever index is current — no new DOM, no
 * new screen. character/goodIcon/badIcon are asset paths; badIcon defaults
 * to the red X (guide 1's "좋지 않은 예" card) — pass the check icon
 * instead when a guide's second card is also a positive example, as guide
 * 2's is. `between` (optional) is the "다음 질문 ↓" separator guide 2 has
 * between its two cards. `third` (optional) is guide 3's extra third card
 * — omit either for guides that don't need them.
 */
const GUIDE_STEPS = [
  {
    title: "또박또박 말씀해 주세요!",
    desc: "AI가 정확하게 이해할 수 있도록 천천히, 또렷하게 답변해 주세요.",
    character: "assets/guide1-character.png",
    good: "“3일 전부터 팔에 두드러기가 생겼어요.”",
    bad: "“어...그게..... 음..... 아...”",
    badIcon: "assets/guide-x-icon.svg",
  },
  {
    title: "한 가지 내용씩 말씀해 주세요.",
    desc: "질문과 관련된 내용을 순서대로 답변하면\n더욱 정확하게 이해할 수 있습니다.",
    character: "assets/guide2-character.png",
    good: "“3일 전부터 팔에 두드러기가 생겼어요.”",
    bad: "“특히 밤에 더 심해져요.”",
    badIcon: "assets/guide-check-icon.svg",
    between: { label: "다음 질문", arrow: "assets/guide-arrow-down.svg" },
  },
  {
    title: "조용한 환경에서 이용해 주세요.",
    desc: "주변 소음이 적을수록 AI가 더욱 정확하게 이해합니다.",
    character: "assets/guide3-character.png",
    good: "주변에서 말하는 사람이 있다면 잠시 기다려 주세요.",
    bad: "마스크를 벗고 말씀해 주세요.",
    badIcon: "assets/guide-check-icon.svg",
    third: "마이크를 향해 또렷하게 말씀해 주세요.",
  },
];

let chatGuideIndex = 0;
let chatGuideShown = false; // only auto-opens the first time the user reaches step 3

function renderChatGuideStep() {
  const modal = document.querySelector(".chat-guide-modal");
  const step = GUIDE_STEPS[chatGuideIndex];
  if (!modal || !step) return;

  modal.dataset.guideIndex = String(chatGuideIndex + 1);

  modal.querySelector("[data-guide-number]").textContent = String(chatGuideIndex + 1);
  modal.querySelector("[data-guide-title]").textContent = step.title;
  modal.querySelector("[data-guide-desc]").textContent = step.desc;
  modal.querySelector("[data-guide-character]").src = step.character;
  modal.querySelector("[data-guide-good-text]").textContent = step.good;
  modal.querySelector("[data-guide-bad-text]").textContent = step.bad;
  modal.querySelector("[data-guide-bad-icon]").src = step.badIcon;

  const betweenLabel = modal.querySelector("[data-guide-between-label]");
  const betweenArrow = modal.querySelector("[data-guide-between-arrow]");
  betweenLabel.hidden = !step.between;
  betweenArrow.hidden = !step.between;
  if (step.between) {
    betweenLabel.textContent = step.between.label;
    betweenArrow.src = step.between.arrow;
  }

  const c3Card = modal.querySelector("[data-guide-c3-card]");
  const c3Icon = modal.querySelector("[data-guide-c3-icon]");
  const c3Text = modal.querySelector("[data-guide-c3-text]");
  c3Card.hidden = !step.third;
  c3Icon.hidden = !step.third;
  c3Text.hidden = !step.third;
  if (step.third) {
    c3Text.textContent = step.third;
  }

  modal.querySelectorAll(".chat-guide-dot").forEach((dot, i) => {
    dot.classList.toggle("is-active", i === chatGuideIndex);
  });

  // Left chevron hides/disables with no previous guide; right chevron does
  // the same at GUIDE_STEPS' last entry (currently guide 3) — there's
  // nowhere further to go, so it shouldn't look clickable.
  modal.querySelector("[data-guide-prev]").disabled = chatGuideIndex === 0;
  modal.querySelector("[data-guide-next]").disabled = chatGuideIndex === GUIDE_STEPS.length - 1;
}

function openChatGuideModalOnce() {
  if (chatGuideShown) return;
  chatGuideShown = true;
  chatGuideIndex = 0;
  renderChatGuideStep();
  const overlay = document.querySelector("[data-guide-overlay]");
  if (overlay) overlay.hidden = false;
}

function initChatGuideModal() {
  const overlay = document.querySelector("[data-guide-overlay]");
  if (!overlay) return;

  overlay.querySelector("[data-guide-close]").addEventListener("click", () => {
    overlay.hidden = true;
  });
  overlay.querySelector("[data-guide-prev]").addEventListener("click", () => {
    if (chatGuideIndex === 0) return;
    chatGuideIndex -= 1;
    renderChatGuideStep();
  });
  overlay.querySelector("[data-guide-next]").addEventListener("click", () => {
    if (chatGuideIndex >= GUIDE_STEPS.length - 1) return; // last guide — button is disabled anyway
    chatGuideIndex += 1;
    renderChatGuideStep();
  });

  renderChatGuideStep(); // set the correct initial prev/next/dot state
}

/**
 * Chat screen's AI voice playback volume (Figma node 2030:2820). No audio
 * element exists yet — currentVolume is the state to read once one does,
 * e.g. `audio.volume = currentVolume / 100;`. 0-100, starts at 50 per spec.
 */
let currentVolume = 50;

function setChatVolume(value) {
  currentVolume = value;
  // Wire in once AI voice playback exists:
  // aiAudioElement.volume = currentVolume / 100;
}

function initChatVolumeControl() {
  const slider = document.querySelector("[data-volume-slider]");
  if (!slider) return;

  const applyFill = () => slider.style.setProperty("--volume-fill", `${slider.value}%`);

  slider.value = String(currentVolume);
  applyFill();

  slider.addEventListener("input", () => {
    setChatVolume(Number(slider.value));
    applyFill();
  });
}

/**
 * Chat screen's central mic idle/listening toggle (Figma node 2039:2991 is
 * the listening-state reference). One state drives every visual: the
 * .is-listening class (mic circle + waveform color/animation, via CSS),
 * the status label text, and the toggle button's aria-pressed/aria-label.
 */
let isListening = false;

function setListening(listening) {
  isListening = listening;

  const voiceInput = document.querySelector("[data-voice-input]");
  const toggle = document.querySelector("[data-mic-toggle]");
  const label = document.querySelector("[data-mic-status-label]");
  if (!voiceInput || !toggle || !label) return;

  voiceInput.classList.toggle("is-listening", isListening);
  toggle.setAttribute("aria-pressed", String(isListening));
  toggle.setAttribute("aria-label", isListening ? "음성 입력 중지" : "음성 입력 시작");
  label.textContent = isListening ? "말씀을 듣고 있습니다." : "말씀해 주세요";
}

function initChatMicToggle() {
  const toggle = document.querySelector("[data-mic-toggle]");
  if (!toggle) return;
  toggle.addEventListener("click", () => setListening(!isListening));
}

/**
 * Conversation history panel (Figma node 2025:1906) content — an
 * array/state structure (not static markup) so a real questionnaire
 * session can push actual turns onto it later. renderChatHistory() is the
 * only thing that needs to run again when this array changes.
 *
 * type: "user" | "system" | "assistant" — who the turn belongs to.
 * status: "listening" | "processing" | "understood" — drives icon, title
 *   color/text, and which optional fields below apply.
 * text: recognized user speech (status: "listening").
 * summary / nextQuestion: AI's response (status: "understood").
 * duration: elapsed-time label shown next to the title, e.g. "00:05".
 */
const CONVERSATION_HISTORY = [
  {
    type: "user",
    status: "listening",
    text: "“3일 전부터 팔에 두드러기가 생겼고 밤에 더 심해졌어요...”",
    duration: "00:05",
  },
  {
    type: "system",
    status: "processing",
  },
  {
    type: "assistant",
    status: "understood",
    summary: "“3일 전부터 발생한 팔 두드러기이며 밤에 증상이 심해짐을 확인했습니다.",
    nextQuestion: "두드러기가 나타난 부위는 어디인가요?",
    duration: "00:03",
  },
];

function buildChatHistoryWaveform(color, small) {
  const wrap = document.createElement("div");
  wrap.className = `chat-history-waveform chat-history-waveform--${color}${small ? " chat-history-waveform--small" : ""}`;
  ["a", "b", "c", "a", "b"].forEach((variant) => {
    const bar = document.createElement("span");
    bar.className = `chat-history-waveform__bar chat-history-waveform__bar--${variant}`;
    wrap.appendChild(bar);
  });
  return wrap;
}

function buildChatHistoryTurn(entry) {
  const turn = document.createElement("div");
  turn.className = `chat-history-turn chat-history-turn--${entry.status}`;

  const header = document.createElement("div");
  header.className = "chat-history-turn__header";
  header.innerHTML = '<span class="chat-history-turn__icon"></span><p class="chat-history-turn__title"></p>';
  if (entry.duration) {
    const duration = document.createElement("span");
    duration.className = "chat-history-turn__duration";
    duration.textContent = entry.duration;
    header.appendChild(duration);
  }
  turn.appendChild(header);
  const title = header.querySelector(".chat-history-turn__title");

  if (entry.status === "listening") {
    title.textContent = "말씀을 듣고 있습니다...";
    turn.appendChild(buildChatHistoryWaveform("red"));
    const quote = document.createElement("p");
    quote.className = "chat-history-turn__quote";
    quote.textContent = entry.text;
    turn.appendChild(quote);
  } else if (entry.status === "processing") {
    title.innerHTML = '음성을 분석하는 중<span class="chat-history-dots"><span>.</span><span>.</span><span>.</span></span>';
  } else if (entry.status === "understood") {
    title.textContent = "이해했습니다.";
    // The check glyph isn't square (7:8), so it's a real <img> sized to its
    // own aspect ratio and centered in the circle via flex — stretching it
    // to fill a square box via background-size percentages (the previous
    // approach) distorted/cropped it, which read as "clipped".
    const checkIcon = document.createElement("img");
    checkIcon.src = "assets/chat-history-icon-check.svg";
    checkIcon.alt = "";
    checkIcon.className = "chat-history-turn__icon-glyph";
    header.querySelector(".chat-history-turn__icon").appendChild(checkIcon);

    const summary = document.createElement("p");
    summary.className = "chat-history-turn__summary";
    summary.textContent = entry.summary;
    turn.appendChild(summary);

    const nextQuestion = document.createElement("div");
    nextQuestion.className = "chat-history-next-question";
    nextQuestion.innerHTML =
      '<span class="chat-history-next-question__icon"></span>' +
      '<div class="chat-history-next-question__body">' +
      '<p class="chat-history-next-question__label">다음 질문입니다.</p>' +
      '<p class="chat-history-next-question__text"></p>' +
      "</div>";
    nextQuestion.querySelector(".chat-history-next-question__text").textContent = entry.nextQuestion;
    nextQuestion.querySelector(".chat-history-next-question__body").appendChild(buildChatHistoryWaveform("blue", true));
    turn.appendChild(nextQuestion);
  }

  return turn;
}

function renderChatHistory() {
  const list = document.querySelector("[data-history-list]");
  if (!list) return;
  list.innerHTML = "";
  CONVERSATION_HISTORY.forEach((entry) => list.appendChild(buildChatHistoryTurn(entry)));
}

function setChatHistoryOpen(open) {
  const overlay = document.querySelector("[data-history-overlay]");
  const toggle = document.querySelector("[data-history-toggle]");
  if (!overlay || !toggle) return;

  overlay.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "대화 기록 닫기" : "대화 기록 열기");
}

function initChatHistoryPanel() {
  const overlay = document.querySelector("[data-history-overlay]");
  const toggle = document.querySelector("[data-history-toggle]");
  if (!overlay || !toggle) return;

  renderChatHistory();

  toggle.addEventListener("click", () => setChatHistoryOpen(overlay.hidden));
  overlay.querySelector("[data-history-close]").addEventListener("click", () => setChatHistoryOpen(false));
}

/**
 * 음성 모드 / 채팅 모드 toggle (Figma node 2052:3304, "chatbot_text", is the
 * chat-mode reference frame). Both modes' markup lives permanently inside
 * .screen[data-screen="chat"] — switching only flips which of
 * .chat-voicemode / .chat-textmode is hidden, so Patient ID, the current
 * question, conversation history, uploaded images and the text-size
 * setting (all declared elsewhere, none of it touched here) never reset.
 */
let chatMode = "voice"; // "voice" | "text"

function setChatMode(mode) {
  if (mode === chatMode) return;
  chatMode = mode;

  const voicePane = document.querySelector("[data-chat-voicemode]");
  const textPane = document.querySelector("[data-chat-textmode]");
  const thumb = document.querySelector(".chat-toggle-thumb");
  if (voicePane) voicePane.hidden = mode !== "voice";
  if (textPane) textPane.hidden = mode !== "text";
  if (thumb) thumb.classList.toggle("is-text", mode === "text");

  // scrollHeight reads as 0 while [hidden] (display: none), so anything
  // measured at render/init time was a no-op if that happened before the
  // pane was ever shown — redo both now that layout is real: scroll to
  // the newest message, and (same reason) re-run the input's auto-resize,
  // since initChatTextMode()'s first call landed on a 0px-tall textarea
  // and never got a chance to correct itself before the user's first
  // keystroke, clipping the placeholder/typed text at the top.
  if (mode === "text") {
    const list = document.querySelector("[data-chat-messages]");
    if (list) list.scrollTop = list.scrollHeight;
    updateChatScrollbarThumb();

    const input = document.querySelector("[data-chat-input]");
    if (input) autoResizeChatInput(input);
  }
}

function initChatModeToggle() {
  const voiceLabel = document.querySelector(".chat-toggle-label--voice");
  const textLabel = document.querySelector(".chat-toggle-label--text");
  const track = document.querySelector(".chat-toggle-track");
  const thumb = document.querySelector(".chat-toggle-thumb");
  if (!voiceLabel || !textLabel) return;

  const selectVoice = () => setChatMode("voice");
  const selectText = () => setChatMode("text");
  const toggleMode = () => setChatMode(chatMode === "voice" ? "text" : "voice");

  const activateOnKey = (handler) => (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };

  [voiceLabel, textLabel].forEach((label) => {
    label.setAttribute("role", "button");
    label.setAttribute("tabindex", "0");
  });
  voiceLabel.addEventListener("click", selectVoice);
  voiceLabel.addEventListener("keydown", activateOnKey(selectVoice));
  textLabel.addEventListener("click", selectText);
  textLabel.addEventListener("keydown", activateOnKey(selectText));
  [track, thumb].forEach((el) => el && el.addEventListener("click", toggleMode));
}

/**
 * Chat mode's message list (Figma node 2052:3304). Mock conversation
 * seeded per spec; sendChatMessage() below appends real user messages the
 * same way. `quickSelect` on an entry renders the chip row directly under
 * that message (Figma places it right under Q3) instead of as a separate
 * fixed block, so it scrolls with the rest of the conversation.
 */
const CHAT_MESSAGES = [
  { sender: "ai", text: "안녕하세요 P001님, 진료 전에 몇 가지 질문을 드리겠습니다.", time: "오후 2:15" },
  { sender: "ai", text: "Q1. 증상이 언제 처음 나타났나요?", time: "오후 2:15" },
  { sender: "user", text: "3일 전부터입니다.", time: "오후 2:16" },
  { sender: "ai", text: "Q2. 주로 나타나는 시간은 언제인가요?", time: "오후 2:16" },
  { sender: "user", text: "주로 낮과 밤에 심해요.", time: "오후 2:16" },
  {
    sender: "ai",
    text: "Q3. 가려움 정도는 어떤가요?",
    time: "오후 2:16",
    quickSelect: ["거의 없음", "약간 가려움", "많이 가려움", "참기 힘듦"],
  },
];

// Mock only for now — wire to the real question count once the
// questionnaire has actual per-question navigation.
const CHAT_PROGRESS = { current: 3, total: 12 };

function buildChatMessageRow(entry) {
  const row = document.createElement("div");
  row.className = `chat-textmode-row chat-textmode-row--${entry.sender}`;

  const bubble = document.createElement("div");
  bubble.className = `chat-textmode-bubble chat-textmode-bubble--${entry.sender}`;

  const header = document.createElement("div");
  header.className = "chat-textmode-bubble__header";
  const label = document.createElement("span");
  label.className = "chat-textmode-bubble__label";
  label.textContent = entry.sender === "ai" ? "AI 문진 도우미" : "나";
  header.appendChild(label);
  if (entry.time) {
    const time = document.createElement("span");
    time.className = "chat-textmode-bubble__time";
    time.textContent = entry.time;
    header.appendChild(time);
  }
  bubble.appendChild(header);

  const text = document.createElement("p");
  text.className = "chat-textmode-bubble__text";
  text.textContent = entry.text;
  bubble.appendChild(text);

  row.appendChild(bubble);
  return row;
}

function buildChatQuickSelect(options) {
  const wrap = document.createElement("div");
  wrap.className = "chat-textmode-quickselect";

  const label = document.createElement("p");
  label.className = "chat-textmode-quickselect__label";
  label.textContent = "빠른 선택";
  wrap.appendChild(label);

  const chipRow = document.createElement("div");
  chipRow.className = "chat-textmode-quickselect__chips";
  options.forEach((option) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-textmode-chip";
    chip.textContent = option;
    chip.dataset.quickselectChip = "";
    chipRow.appendChild(chip);
  });
  wrap.appendChild(chipRow);

  return wrap;
}

/**
 * Fills the input with a chip's text without sending — the user can still
 * edit or append before pressing send. Selecting another chip replaces the
 * selection; editing the input afterward never re-fills it (nothing here
 * listens for input changes), so manual edits are never clobbered.
 */
function selectQuickSelectChip(chip) {
  const input = document.querySelector("[data-chat-input]");
  if (!input) return;

  document.querySelectorAll("[data-quickselect-chip]").forEach((c) => c.classList.remove("is-selected"));
  chip.classList.add("is-selected");

  input.value = chip.textContent;
  autoResizeChatInput(input);
  updateChatSendState();
  input.focus();
}

function bindQuickSelectChips() {
  document.querySelectorAll("[data-quickselect-chip]").forEach((chip) => {
    chip.addEventListener("click", () => selectQuickSelectChip(chip));
  });
}

function renderChatMessages() {
  const list = document.querySelector("[data-chat-messages]");
  if (!list) return;

  list.innerHTML = "";
  CHAT_MESSAGES.forEach((entry) => {
    list.appendChild(buildChatMessageRow(entry));
    if (entry.quickSelect) list.appendChild(buildChatQuickSelect(entry.quickSelect));
  });
  bindQuickSelectChips();
  list.scrollTop = list.scrollHeight;
  updateChatScrollbarThumb();
}

/**
 * Sizes/positions .chat-textmode-scrollbar-thumb from the message list's
 * real scrollTop/scrollHeight/clientHeight. Stands in for the native
 * scrollbar, which stays hidden outright (style.css) — macOS Chrome's
 * overlay-scrollbar mode was confirmed (via a real screenshot) to ignore
 * a custom ::-webkit-scrollbar width and render at its own thick system
 * width regardless of what CSS asks for, so a plain div under our own
 * control is the only reliable way to get an actually-thin indicator.
 */
function updateChatScrollbarThumb() {
  const list = document.querySelector("[data-chat-messages]");
  const thumb = document.querySelector("[data-scroll-indicator]");
  if (!list || !thumb) return;

  const { scrollTop, scrollHeight, clientHeight } = list;
  if (scrollHeight <= clientHeight + 1) {
    thumb.style.display = "none";
    return;
  }

  const trackHeight = clientHeight;
  const thumbHeight = Math.max((clientHeight / scrollHeight) * trackHeight, 6);
  const maxTop = trackHeight - thumbHeight;
  const scrollRatio = scrollTop / (scrollHeight - clientHeight);

  thumb.style.display = "block";
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.top = `${scrollRatio * maxTop}px`;
}

function renderChatProgress() {
  const currentEl = document.querySelector("[data-progress-current]");
  const totalEl = document.querySelector("[data-progress-total]");
  const fillEl = document.querySelector("[data-progress-fill]");

  if (currentEl) currentEl.textContent = String(CHAT_PROGRESS.current);
  if (totalEl) totalEl.textContent = String(CHAT_PROGRESS.total);
  if (fillEl) fillEl.style.width = `${(CHAT_PROGRESS.current / CHAT_PROGRESS.total) * 100}%`;
}

const CHAT_INPUT_MAX_HEIGHT = 16; // px — matches .chat-textmode-input's max-height (~4 lines)

function autoResizeChatInput(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT)}px`;
  // Without this, deleting text back down after typing past max-height
  // leaves the box's old scroll offset in place — the (now short) box
  // stays scrolled to where the caret last was, pushing the one line of
  // text up out of view instead of showing it from the top.
  input.scrollTop = 0;
}

function updateChatSendState() {
  const input = document.querySelector("[data-chat-input]");
  const send = document.querySelector("[data-chat-send]");
  if (!input || !send) return;
  send.disabled = input.value.trim().length === 0;
}

function currentTimeLabel() {
  const now = new Date();
  const hours24 = now.getHours();
  const period = hours24 < 12 ? "오전" : "오후";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${period} ${hours12}:${minutes}`;
}

/**
 * Appends the current input as a new user message bubble. Also clears any
 * chip selection and prepares (without yet implementing) the extension
 * point for a real next mock AI question — push it onto CHAT_MESSAGES
 * where the comment below marks, once one exists.
 */
function sendChatMessage() {
  const input = document.querySelector("[data-chat-input]");
  if (!input) return;

  const value = input.value.trim();
  if (!value) return;

  CHAT_MESSAGES.push({ sender: "user", text: value, time: currentTimeLabel() });
  // Next mock AI question hook: CHAT_MESSAGES.push({ sender: "ai", ... })
  // here once real question progression exists.

  input.value = "";
  autoResizeChatInput(input);
  updateChatSendState();

  renderChatMessages();
}

function initChatTextMode() {
  renderChatProgress();
  renderChatMessages();

  const list = document.querySelector("[data-chat-messages]");
  if (list) list.addEventListener("scroll", updateChatScrollbarThumb);

  const input = document.querySelector("[data-chat-input]");
  const send = document.querySelector("[data-chat-send]");
  if (!input || !send) return;

  updateChatSendState();
  // Without this, the textarea keeps its native rows="1" height (sized
  // from the browser's own default line-height metrics, not this input's
  // custom font/line-height) until the user's first keystroke — which
  // could be a hair shorter than one real line, clipping the top of the
  // placeholder/typed text and forcing an internal scroll from the start.
  autoResizeChatInput(input);

  input.addEventListener("input", () => {
    autoResizeChatInput(input);
    updateChatSendState();
  });
  input.addEventListener("keydown", (event) => {
    // isComposing (plus the legacy keyCode 229 check some browsers still
    // need) guards against IME composition — Korean/Japanese/Chinese
    // input methods use Enter to confirm a composed syllable block, not
    // to submit, so without this guard every such Enter mid-sentence was
    // sending a partial message and splitting one answer into several.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!send.disabled) sendChatMessage();
    }
  });
  send.addEventListener("click", () => {
    if (!send.disabled) sendChatMessage();
  });
}

/**
 * Step 4 완료 screen (Figma node 177:509). Reached via the chat screen's
 * "문진 종료하기" button, already wired through initNextButtons()'s
 * generic [data-next] handling. "나가기" (data-next="onboarding-1") and
 * "설문 참여하기" (data-next="survey-1") both navigate the same generic
 * way now — no custom click handlers needed for either.
 */

/**
 * Post-visit survey, Q1-Q10 (Figma nodes 2052:3447 / 2052:3567), reached
 * from the done screen's "설문 참여하기" button. Q1-Q8 are all the same
 * shape (bold "Qn." + question text + a row of 5 equal-width option
 * pills), so they're generated from these two arrays into
 * .survey-question blocks rather than hand-written 8 times — edit
 * question text/options here. Q9/Q10 have their own one-off markup in
 * index.html since neither matches this shape.
 */
const SURVEY_PAGE1_QUESTIONS = [
  { id: "q1", number: "Q1.", text: "전체 문진 과정은 사용하기 쉬웠나요?", options: ["매우어려움", "어려움", "보통", "쉬움", "매우 쉬움"] },
  { id: "q2", number: "Q2.", text: "다음에 무엇을 해야 하는지 쉽게 알 수 있었나요?", options: ["전혀아니다", "아니다", "보통", "그렇다", "매우 그렇다"] },
  { id: "q3", number: "Q3.", text: "증상 사진을 촬영하거나 업로드하는 방법을 쉽게 이해할 수 있었나요?", options: ["전혀아니다", "아니다", "보통", "그렇다", "매우 그렇다"] },
  { id: "q4", number: "Q4.", text: "AI가 질문하는 내용을 이해하기 쉬웠나요?", options: ["전혀아니다", "아니다", "보통", "그렇다", "매우 그렇다"] },
  { id: "q5", number: "Q5.", text: "AI의 질문에 답변하는 과정이 편리했나요?", options: ["전혀아니다", "아니다", "보통", "그렇다", "매우 그렇다"] },
];

const SURVEY_PAGE2_QUESTIONS = [
  { id: "q6", number: "Q6.", text: "AI 문진을 이용하는 동안 안심하고 정보를 입력할 수 있었나요?", options: ["전혀아니다", "아니다", "보통", "그렇다", "매우그렇다"] },
  { id: "q7", number: "Q7.", text: "이번 문진이 의료진에게 내 증상을 전달하는 데 도움이 될 거 같나요?", options: ["전혀아니다", "아니다", "보통", "그렇다", "매우그렇다"] },
  { id: "q8", number: "Q8.", text: "전체적으로 이번 문진 경험에 만족하시나요?", options: ["매우 불만족", "불만족", "보통", "만족", "매우 만족"] },
];

// Every question block is a fixed 21px tall in Figma (22 → 43 → 64 → 85 →
// 106), so each .survey-question's `top` is just its index times this.
const SURVEY_QUESTION_ROW_HEIGHT = 21;
const SURVEY_QUESTION_FIRST_TOP = 22;

/**
 * All ten answers live here — the single source of truth read by both
 * pages' validation and by submitSurvey()'s console.log at the end.
 * Survives page-1 → page-2 navigation since it's just a JS variable, not
 * anything tied to the DOM of either screen.
 */
const SURVEY_STATE = {
  q1: null,
  q2: null,
  q3: null,
  q4: null,
  q5: null,
  q6: null,
  q7: null,
  q8: null,
  q9: { answer: null, detail: "" },
  q10: "",
};

function buildSurveyQuestion(question, topPx) {
  const block = document.createElement("div");
  block.className = "survey-question";
  block.style.top = `${topPx}px`;

  const number = document.createElement("p");
  number.className = "survey-question__number";
  number.textContent = question.number;
  block.appendChild(number);

  const text = document.createElement("p");
  text.className = "survey-question__text";
  text.textContent = question.text;
  block.appendChild(text);

  const options = document.createElement("div");
  options.className = "survey-options";
  options.setAttribute("role", "radiogroup");
  options.setAttribute("aria-label", `${question.number} ${question.text}`);
  question.options.forEach((label) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "survey-option";
    option.textContent = label;
    option.dataset.surveyOption = question.id;
    option.dataset.surveyValue = label;
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", "false");
    options.appendChild(option);
  });
  block.appendChild(options);

  return block;
}

/**
 * Renders one page's question array into its [data-survey-questions]
 * container and wires each option's click. Selecting an option sets
 * SURVEY_STATE[question.id], updates that question's pills (only one
 * .is-selected/aria-checked="true" per question at a time), and
 * re-validates whichever page is showing.
 */
function renderSurveyQuestions(pageNumber, questions) {
  const container = document.querySelector(`[data-survey-questions="${pageNumber}"]`);
  if (!container) return;

  container.innerHTML = "";
  questions.forEach((question, index) => {
    const topPx = SURVEY_QUESTION_FIRST_TOP + index * SURVEY_QUESTION_ROW_HEIGHT;
    container.appendChild(buildSurveyQuestion(question, topPx));
  });

  container.querySelectorAll("[data-survey-option]").forEach((option) => {
    option.addEventListener("click", () => {
      const questionId = option.dataset.surveyOption;
      SURVEY_STATE[questionId] = option.dataset.surveyValue;

      container.querySelectorAll(`[data-survey-option="${questionId}"]`).forEach((sibling) => {
        const selected = sibling === option;
        sibling.classList.toggle("is-selected", selected);
        sibling.setAttribute("aria-checked", String(selected));
      });

      updateSurveyPage1NextState();
      updateSurveySubmitState();
    });
  });
}

function updateSurveyPage1NextState() {
  const button = document.querySelector('[data-survey-next="1"]');
  if (!button) return;
  button.disabled = !(SURVEY_STATE.q1 && SURVEY_STATE.q2 && SURVEY_STATE.q3 && SURVEY_STATE.q4 && SURVEY_STATE.q5);
}

function updateSurveySubmitState() {
  const button = document.querySelector("[data-survey-submit]");
  if (!button) return;

  const scaleAnswered = SURVEY_STATE.q6 && SURVEY_STATE.q7 && SURVEY_STATE.q8;
  const q9Answered =
    SURVEY_STATE.q9.answer === "no" || (SURVEY_STATE.q9.answer === "yes" && SURVEY_STATE.q9.detail.trim().length > 0);
  // Q10 is optional — intentionally not part of this check.

  button.disabled = !(scaleAnswered && q9Answered);
}

/** Q9's yes/no radios + the detail input that only applies to "yes". */
function initSurveyQ9() {
  const yesButton = document.querySelector('[data-survey-q9-option="yes"]');
  const noButton = document.querySelector('[data-survey-q9-option="no"]');
  const detailInput = document.querySelector("[data-survey-q9-detail]");
  if (!yesButton || !noButton || !detailInput) return;

  const selectAnswer = (answer) => {
    SURVEY_STATE.q9.answer = answer;
    yesButton.classList.toggle("is-selected", answer === "yes");
    yesButton.setAttribute("aria-checked", String(answer === "yes"));
    noButton.classList.toggle("is-selected", answer === "no");
    noButton.setAttribute("aria-checked", String(answer === "no"));

    detailInput.disabled = answer !== "yes";
    if (answer !== "yes") {
      // "아니요" clears the optional description, per spec.
      detailInput.value = "";
      SURVEY_STATE.q9.detail = "";
    }
    updateSurveySubmitState();
  };

  yesButton.addEventListener("click", () => {
    selectAnswer("yes");
    detailInput.focus();
  });
  noButton.addEventListener("click", () => selectAnswer("no"));
  detailInput.addEventListener("input", () => {
    SURVEY_STATE.q9.detail = detailInput.value;
    updateSurveySubmitState();
  });
}

function initSurveyQ10() {
  const textarea = document.querySelector("[data-survey-q10]");
  if (!textarea) return;
  textarea.addEventListener("input", () => {
    SURVEY_STATE.q10 = textarea.value;
  });
}

/**
 * Collects SURVEY_STATE into the response shape, logs it (no backend
 * exists yet — TODO once one does), then shows the survey-complete
 * screen instead of reloading or leaving the app.
 */
function submitSurvey() {
  const response = {
    q1: SURVEY_STATE.q1,
    q2: SURVEY_STATE.q2,
    q3: SURVEY_STATE.q3,
    q4: SURVEY_STATE.q4,
    q5: SURVEY_STATE.q5,
    q6: SURVEY_STATE.q6,
    q7: SURVEY_STATE.q7,
    q8: SURVEY_STATE.q8,
    q9: { answer: SURVEY_STATE.q9.answer, detail: SURVEY_STATE.q9.detail },
    q10: SURVEY_STATE.q10,
  };

  // TODO: POST this to a real endpoint once the survey has a backend.
  console.log("[설문 제출]", response);

  goToScreen("survey-complete");
}

function initSurvey() {
  renderSurveyQuestions(1, SURVEY_PAGE1_QUESTIONS);
  renderSurveyQuestions(2, SURVEY_PAGE2_QUESTIONS);
  initSurveyQ9();
  initSurveyQ10();
  updateSurveyPage1NextState();
  updateSurveySubmitState();

  const submitButton = document.querySelector("[data-survey-submit]");
  submitButton?.addEventListener("click", () => {
    if (!submitButton.disabled) submitSurvey();
  });
}


window.addEventListener("DOMContentLoaded", () => {
  initGlobalTextScale();
  initNextButtons();
  initProgressDots();
  initConsentGates();
  initKeyboardFocusTracking();
  initPatientIdScreen();
  initTextSizeControlScreen();
  initPatientIdTextSizeControl();
  initImageUploadScreen();
  initChatGuideModal();
  initChatVolumeControl();
  initChatMicToggle();
  initChatHistoryPanel();
  initChatModeToggle();
  initChatTextMode();
  initSurvey();
  fitStage();
});

window.addEventListener("resize", fitStage);
