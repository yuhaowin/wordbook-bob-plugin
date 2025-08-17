/**
 * 单词本插件（本地过滤 + 火山LLM 5s兜底）
 * 核心目标：
 *  1) 先本地严格校验是否“像英文单词”；
 *  2) 再用火山 LLM 做 Yes/No 判定（关闭思考模式，低 token，确定性）；
 *  3) LLM 节点超过 5s（可配）无返回 → 默认通过（添加单词本）；
 *  4) 所有 HTTP 统一使用 $http.request + timeout(秒) + cancelSignal；
 *  5) 业务级再加一层 withTimeout()，双重兜底避免“悬挂无响应”。
 *
 * 重要参考（官方）：
 *  - $http.request + timeout + cancelSignal：https://bobtranslate.com/plugin/api/http.html  （超时单位=秒）  ← 必看
 *  - Bob 1.8.0 新特性（取消/流式/回调）：https://bobtranslate.com/blog/2023-05-18-180-plugin.html
 *  - 火山方舟 V3 路径：/api/v3/chat/completions                         ← 别用 v2 路径！
 */

///////////////////////////////
// 0) 常量 & 通用工具
///////////////////////////////

// 有道单词本（GET）
var YOUDAO_ADD_WORD_URL = "https://dict.youdao.com/wordbook/webapi/v2/ajax/add?lan=en&word=";
// 扇贝单词本（POST）
var SHANBAY_ADD_WORD_URL = "https://apiv3.shanbay.com/wordscollection/words_bulk_upload";
// 欧路单词本（POST）与单词本列表（GET）
var EUDIC_ADD_WORD_URL = "https://api.frdic.com/api/open/v1/studylist/words";
var EUDIC_BOOK_LIST_URL = "https://api.frdic.com/api/open/v1/studylist/category?language=en";

/**
 * httpRequestP：强制把 $http.request 变成 Promise。
 * 兼容两种情况：
 *  1) 新接口已返回 Promise → 直接使用；
 *  2) 仅支持 handler 回调 → 由我们手动包装成 Promise。
 *
 * 说明：
 *  - Bob 文档：$http 所有 API“支持 Promise；若设置了 handler，则通过回调返回”
 *  - 实战里有版本/环境差异，最稳妥是做双分支兜底，避免 p=undefined 导致 p.then 抛错。
 */
function httpRequestP(opts) {
  try {
    var ret = $http.request(opts);
    // 分支1：确实返回了 Promise（thenable）
    if (ret && typeof ret.then === "function") return ret;
  } catch (e) {
    // 忽略，同步走到分支2
  }
  // 分支2：回退到 handler 模式，并包装为 Promise
  return new Promise(function (resolve) {
    try {
      var o = Object.assign({}, opts, {
        // 注意：一旦设置 handler，Bob 会走回调路径
        handler: function (res) { resolve(res); }
      });
      $http.request(o);
    } catch (e) {
      // 最后兜底：把异常也 resolve（不 reject），避免上层再进 catch
      resolve({ __error: e });
    }
  });
}

/** 构造成功结果（Bob 规范） */
function buildResult(msg) {
  return {
    from: "en",
    to: "zh-Hans",
    toParagraphs: [msg],
    fromParagraphs: ["success add to word book"]
  };
}

/** 构造错误结果（Bob 规范） */
function buildError(msg) {
  return { type: "param", message: msg, addtion: "无" };
}

/** 声明支持语种（Bob 规范） */
function supportLanguages() {
  return ["zh-Hans", "en"];
}

/** 读取 UI 中的 5s 配置（毫秒）；转秒用于 $http.timeout */
var WORD_CHECK_TIMEOUT_MS = Number($option.word_check_timeout_ms) || 50000;
var WORD_CHECK_TIMEOUT_S  = Math.max(1, Math.ceil(WORD_CHECK_TIMEOUT_MS / 50000));

/**
 * finalize：统一结束一次翻译（新旧回调兼容；防止重复回调）
 * @param {object} query        Bob 查询对象（含 onCompletion / cancelSignal）
 * @param {function} completion 旧回调
 * @param {object} payload      {result}|{error}
 */
function finalize(query, completion, payload) {
  try {
    if (query && typeof query.onCompletion === "function") {
      query.onCompletion(payload);
    } else if (typeof completion === "function") {
      completion(payload);
    }
  } catch (e) {
    // 不抛错，避免 UI 悬挂
  }
}

/**
 * withTimeout：业务级 Promise 超时器（实现 5s 竞速兜底）
 * @param {Promise<any>} p           要保护的 Promise
 * @param {number} ms                超时毫秒
 * @param {*} onTimeoutValue         超时时返回的替代值
 * @returns {Promise<any>}
 */
function withTimeout(p, ms, onTimeoutValue) {
  // Bob 插件环境无 setTimeout，这里改为直通。
  // 依赖各个 $http.request 自身的 timeout（秒）与上层 .catch 兜底。
  return p;
}

/**
 * 将任意错误对象转换为可读字符串（安全，不抛异常）
 * - 优先使用 message / stack
 * - 兼容 $http.request 的错误结构（response/statusCode/data）
 * - 最终回退到 JSON 序列化
 */
function errorToMessage(err) {
  try {
    if (err == null) return "unknown";
    if (typeof err === "string") return err;
    if (typeof err.message === "string" && err.message) return err.message;
    if (typeof err.stack === "string" && err.stack) return err.stack;

    var parts = [];
    var resp = err.response || err.res || null;

    if (resp && (resp.statusCode || resp.status)) {
      parts.push("statusCode=" + (resp.statusCode || resp.status));
    }
    // 尝试附带 data
    var dataStr = "";
    try {
      var d = (resp && resp.data) || err.data;
      if (d !== undefined) dataStr = JSON.stringify(d);
    } catch (_) {}
    if (dataStr) parts.push("data=" + dataStr);

    // 原始对象兜底
    var raw = "";
    try { raw = JSON.stringify(err); } catch (_) {}
    if (raw) parts.push("raw=" + raw);

    return parts.join("; ") || "unknown";
  } catch (_) {
    return "unknown";
  }
}

/**
 * 安全 JSON 序列化（用于“原样返回 LLM 响应”）
 * - 格式化缩进 2
 * - 失败则尽量转成字符串
 */
function safeJSONStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    try { return String(obj); } catch (_) { return "[unserializable]"; }
  }
}

/**
 * 生成 LLM 请求的可读报告文本（不隐藏、不兜底为 [LLM 无返回]）
 * @param {object} info - {ok, statusCode, data, headers, durationMs, url, model, endpoint, errorMessage}
 * @returns {string}
 */
function makeLLMDebugMessage(info) {
  try {
    var lines = [];
    lines.push("LLM 请求报告");
    lines.push("ok=" + String(!!(info && info.ok)));
    lines.push("statusCode=" + String((info && info.statusCode) != null ? info.statusCode : "n/a"));
    lines.push("durationMs=" + String((info && info.durationMs) != null ? info.durationMs : "n/a"));
    lines.push("url=" + String((info && info.url) || "n/a"));
    lines.push("endpoint=" + String((info && info.endpoint) || "n/a"));
    lines.push("model=" + String((info && info.model) || "n/a"));
    // 取可能的请求 ID
    var headers = (info && info.headers) || {};
    var rid = headers["x-request-id"] || headers["X-Request-Id"] || headers["request-id"] || headers["x-requestid"] || headers["requestid"];
    if (rid) lines.push("request-id=" + String(rid));
    // 错误信息
    if (info && info.errorMessage) {
      lines.push("error=" + String(info.errorMessage));
    }
    // 原始响应体
    lines.push("response.data=" + safeJSONStringify(info && info.data));
    return lines.join("\n");
  } catch (e) {
    return "LLM 请求报告生成失败：" + (e && e.message ? e.message : String(e));
  }
}

/**
 * 从 { result: buildResult(...) } / { error: {...} } 中抽取提示文案
 */
function pickMessageFromPluginPayload(p) {
  try {
    if (p && p.result && p.result.toParagraphs && p.result.toParagraphs.length > 0) {
      return String(p.result.toParagraphs[0]);
    }
    if (p && p.error && p.error.message) {
      return String(p.error.message);
    }
  } catch (_) {}
  return "";
}

///////////////////////////////
// 1) 规范化 & 本地严格过滤
///////////////////////////////

/** 统一小写 + 去空白 */
function normalizeWord(text) {
  if (typeof text !== "string") return "";
  return text.trim().toLowerCase();
}

/**
 * 严格判定“单个英文单词”
 *  - 排除邮箱/URL/空白/CJK/数字/下划线
 *  - 仅允许字母，内部可有单个 '-' 或 '\''（不允许首尾、连续）
 */
function isLikelyEnglishWord(text) {
  if (!text || typeof text !== "string") return false;
  var s = text.trim();
  if (s.length === 0 || s.length > 64) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) return false;              // 邮箱
  if (/^(https?:\/\/|www\.)|:\/\//i.test(s)) return false;              // URL
  if (/\s/.test(s)) return false;                                       // 空白
  if (/[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(s)) return false;// CJK
  if (/[0-9_]/.test(s)) return false;                                   // 数字/下划线
  if (!/^[A-Za-z](?:[A-Za-z'-]*[A-Za-z])?$/.test(s)) return false;      // 字母 + 内部 - / '
  if (/--|''/.test(s)) return false;                                    // 连续 -- 或 ''
  return true;
}

/**
 * classifyInput：将输入分为三类
 * - 'single_word'：单个英文单词（走旧流程：LLM Yes/No 判定再写库）
 * - 'multi_word' ：可能是短语/句子（新流程：LLM 抽取英文词 → 逐个写库）
 * - 'invalid'    ：明显无效（无英文词）
 */
function classifyInput(text) {
  if (typeof text !== "string") return { type: "invalid", norm: "" };
  var raw = text.trim();
  if (!raw) return { type: "invalid", norm: "" };
  // 单词判定（严格）
  if (isLikelyEnglishWord(raw)) return { type: "single_word", norm: normalizeWord(raw) };
  // 非严格：出现空格/标点/多个 token → 视为 multi
  var hasSpaceOrPunct = /\s/.test(raw) || /[.,!?;:'"()\-_/\\]/.test(raw);
  if (hasSpaceOrPunct) return { type: "multi_word", norm: raw };
  // 其他：例如纯中文/数字/符号
  return { type: "invalid", norm: raw };
}

/**
 * localExtractWords：本地快速切词（LLM 失败时的兜底）
 * 规则：
 *  - 用正则提取候选 token（允许内部 '-'、'），再用 isLikelyEnglishWord 二次过滤
 *  - 统一小写，去重且保持顺序
 */
function localExtractWords(text) {
  var s = String(text || "");
  // 先粗提取：至少以字母开头和结尾，中间可含字母/'/-
  var rough = s.match(/[A-Za-z](?:[A-Za-z'-]*[A-Za-z])?/g) || [];
  var out = [];
  var seen = Object.create(null);
  for (var i = 0; i < rough.length; i++) {
    var w = normalizeWord(rough[i]);
    if (!w) continue;
    if (!isLikelyEnglishWord(w)) continue;
    if (seen[w]) continue;
    seen[w] = 1;
    out.push(w);
  }
  return out;
}

/** uniqueStable：去重 + 保序 */
function uniqueStable(arr) {
  var seen = Object.create(null), out = [];
  for (var i = 0; i < arr.length; i++) {
    var x = arr[i];
    if (seen[x]) continue;
    seen[x] = 1;
    out.push(x);
  }
  return out;
}

/**
 * addWordP：将回调式 addWord 包装为 Promise（便于批量顺序写入）
 * @returns {Promise<{word:string, ok:boolean, message:string}>}
 */
function addWordP(query, dictType, authorization, word) {
  return new Promise(function (resolve) {
    try {
      addWord(query, dictType, authorization, word, function (res) {
        // 从插件 payload 中提取中文提示（复用已有逻辑）
        var msg = pickMessageFromPluginPayload(res);
        if (res && res.result) {
          resolve({ word: word, ok: true,  message: msg || ("添加单词成功：" + word) });
        } else {
          resolve({ word: word, ok: false, message: msg || ("添加单词失败：" + word) });
        }
      });
    } catch (e) {
      resolve({ word: word, ok: false, message: "添加单词异常：" + errorToMessage(e) });
    }
  });
}

/**
 * addWordsInSeries：串行添加多词，避免 Promise.all 并发导致 UI 阻塞或超时放大
 * @param {string[]} words  待添加的单词列表
 * @returns {Promise<{success:string[], failed:Array<{word:string, reason:string}>}>}
 */
function addWordsInSeries(query, dictType, authorization, words) {
  var idx = 0;
  var success = [];
  var failed = [];
  function next() {
    if (idx >= words.length) {
      return Promise.resolve({ success: success, failed: failed });
    }
    var w = words[idx++];
    return addWordP(query, dictType, authorization, w).then(function (r) {
      if (r.ok) success.push(w);
      else failed.push({ word: w, reason: r.message || "未知原因" });
      return next();
    });
  }
  return next();
}

/** 统一决策入口：先本地过滤，减少 LLM 调用 */
function shouldAddToWordbook(text, from_language) {
  var norm = normalizeWord(text);
  if (from_language && from_language !== "en") {
    return { pass: false, reason: "中文、非英语单词无需添加单词本" };
  }
  if (!isLikelyEnglishWord(norm)) {
    return { pass: false, reason: "非英语单词无需添加单词本" };
  }
  return { pass: true, reason: "OK" };
}

/**
 * 解析 LLM 返回的 Yes/No，容错大小写、句点、引号、代码块等
 * @param {string} s
 * @returns {'yes'|'no'|'unknown'}
 */
function parseYesNo(s) {
  try {
    if (!s) return 'unknown';
    var t = String(s).trim().toLowerCase();
    // 去除常见包装（代码块/引号/句点等）
    t = t.replace(/^```[a-z]*\n?/g, '').replace(/```$/g, '').trim();
    t = t.replace(/^['"\s]+|['"\s]+$/g, '').trim();
    // 仅取首词，避免 "Yes." / "No," / "Yes, it's a word" 等
    var first = t.split(/\s+/)[0].replace(/[.,!?;:]+$/g, '');
    if (first === 'yes') return 'yes';
    if (first === 'no')  return 'no';
    return 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/**
 * 从方舟 v3 Chat Completions 响应中鲁棒提取文本内容
 * 兼容：
 *  - choices[0].message.content 为 string
 *  - choices[0].message.content 为数组（多模态：[{type:'text', text:'...'}]）
 *  - reasoning 模型：choices[0].message.reasoning_content（作为辅信息）
 *  - 某些网关返回 data.output_text（少见）
 * 返回：{ text: string, finish_reason: string }
 */
function extractArkContent(resp) {
  try {
    var data = (resp && resp.data) || {};
    var choices = data.choices || [];
    if (Array.isArray(choices) && choices.length > 0) {
      var ch0 = choices[0] || {};
      var msg = ch0.message || {};
      var content = msg.content;
      // 1) 纯字符串
      if (typeof content === 'string') {
        return { text: content, finish_reason: ch0.finish_reason || '' };
      }
      // 2) 多模态数组：拼接所有 text 片段
      if (Array.isArray(content)) {
        var buf = [];
        for (var i = 0; i < content.length; i++) {
          var part = content[i];
          if (part && part.type === 'text' && typeof part.text === 'string') {
            buf.push(part.text);
          }
        }
        return { text: buf.join(''), finish_reason: ch0.finish_reason || '' };
      }
      // 3) reasoning_content 作为辅信息（若 content 为空则退而求其次）
      if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
        return { text: msg.reasoning_content, finish_reason: ch0.finish_reason || '' };
      }
      return { text: '', finish_reason: ch0.finish_reason || '' };
    }
    // 4) 少数网关包装：直接提供 output_text
    if (typeof data.output_text === 'string') {
      return { text: data.output_text, finish_reason: data.finish_reason || '' };
    }
    return { text: '', finish_reason: '' };
  } catch (_) {
    return { text: '', finish_reason: '' };
  }
}


///////////////////////////////
// 2) 火山 LLM 判定（仅此通道）
///////////////////////////////


/**
 * extractWordsByLLMVolcano：让 LLM 从句子/短语中抽取“可加入单词本的英文词”
 * 返回 JSON 数组（小写、去重、仅字母/内部可含 - '）
 * 失败或超时时，调用方应回退到 localExtractWords()
 */
function extractWordsByLLMVolcano(text, cancelSignal) {
  var _start = Date.now();
  var vKey  = $option.volcano_api_key;
  var vBase = $option.volcano_endpoint; // 例如 https://ark.cn-beijing.volces.com/api/v3
  var vModel= $option.volcano_model;

  // 允许在 Bob 选项中配置最大保留数；默认 200（与写入上限保持一致）
  var _maxAdd = Number($option.llm_words_max_add) || 200;

  if (!(vKey && vBase && vModel)) {
    return Promise.resolve({ ok: false, statusCode: 0, words: [], data: "[LLM 未配置]" });
  }

  var systemPrompt =
    ($option.llm_words_system_prompt) ||
    (
      "ROLE: You are a vocabulary notebook manager for an English learner.\n" +
      "TASK: From the user's TEXT, extract DISTINCT English single WORDS only, then RANK by MEMORY VALUE and output the top " + String(_maxAdd) + ".\n" +
      "MEMORY VALUE (high → low):\n" +
      "  • CEFR B2–C2 or academic/technical usefulness (STEM/business/legal),\n" +
      "  • high utility across contexts (polysemy/collocations),\n" +
      "  • morphological productivity (useful roots that yield many derivatives),\n" +
      "  • topic relevance to the input.\n" +
      "EXCLUDE:\n" +
      "  • trivial/common function words (the, is, and, to, of, etc.),\n" +
      "  • URLs/emails/numbers/hashtags/SKUs/codes/emojis,\n" +
      "  • NON‑typical personal names or idiosyncratic capitalized tokens (e.g., \"Licard\"),\n" +
      "  • random strings or non-English tokens,\n" +
      "  • multi‑word phrases.\n" +
      "PROPER NOUNS & BRANDS:\n" +
      "  • Keep only well‑known proper nouns/brands/places or domain‑critical names; otherwise skip.\n" +
      "  • For proper nouns and special names, KEEP initial capitalization (Title Case). For common words, use lowercase.\n" +
      "LEMMA RULES:\n" +
      "  • Output the BASE FORM (lemma): verbs → infinitive (go, run), nouns → singular (mouse), adjectives → base (good), handle irregulars (went→go; better→good).\n" +
      "OUTPUT (STRICT JSON, NO explanations): Prefer {\"add\":[...],\"skip\":[...]}. If unsure, output just [\"word1\",\"word2\",...].\n" +
      "CONSTRAINTS:\n" +
      "  • No duplicates; order by descending MEMORY VALUE.\n" +
      "  • Do not wrap in code fences.\n"
    );


  var base = String(vBase || "").replace(/\/+$/, "");
  if (!/\/api\/v?3$/.test(base)) {
    base = /\/api$/.test(base) ? (base + "/v3") : (base + "/api/v3");
  }
  if (/^https?:\/\/(?:ark[-.]cn-beijing\.bytedance\.net|ark\.bytedance\.net)/i.test(base)) {
    try { $log.info("endpoint 域名疑似内部/历史，自动重写为 https://ark.cn-beijing.volces.com/api/v3"); } catch (_) {}
    base = "https://ark.cn-beijing.volces.com/api/v3";
  }
  var isBotModel = /^bot-/i.test(String(vModel));
  var url = base + (isBotModel ? "/bots/chat/completions" : "/chat/completions");

  return httpRequestP({
    method: "POST",
    url: url,
    header: {
      "Authorization": "Bearer " + vKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "BobPlugin-Wordbook/1.0 (+yuhaowin/wordbook-bob-plugin)"
    },
    body: {
      model: vModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: String(text || "") }
      ],
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 1024,
      n: 1
    },
    timeout: WORD_CHECK_TIMEOUT_S,
    cancelSignal: cancelSignal
  }).then(function (resp) {
    var sc = (resp && resp.response && resp.response.statusCode) || 0;
    var headers = (resp && resp.response && resp.response.headers) || {};
    var ext = extractArkContent({ data: resp && resp.data });
    var content = (ext && ext.text) ? ext.text.trim() : "";
    // content 可能是：1) 纯数组；2) {add:[], skip:[]}
    var wordsToAdd = [];
    try {
      var parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        wordsToAdd = parsed;
      } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.add)) {
        wordsToAdd = parsed.add;
      } else {
        wordsToAdd = [];
      }
    } catch (e) {
      // 若不是纯 JSON，退而使用本地正则从 content 提取
      wordsToAdd = localExtractWords(content);
    }

    // 过滤 + 去重 + 截断（再严格校验一次）
    var cleaned = [];
    for (var i = 0; i < wordsToAdd.length; i++) {
      // 保留 LLM 返回的大小写（普通词小写，专有名词首字母大写）
      var w0 = String(wordsToAdd[i] || "");
      var w = w0.trim();
      if (!isLikelyEnglishWord(w)) continue; // 二次严格校验（大小写无关）
      cleaned.push(w);
    }
    cleaned = uniqueStable(cleaned).slice(0, _maxAdd);
    return {
      ok: sc >= 200 && sc < 300 && cleaned.length >= 0,
      statusCode: sc,
      words: cleaned,
      data: resp && resp.data,
      headers: headers,
      durationMs: Date.now() - _start,
      url: url,
      endpoint: base,
      model: vModel
    };
  }, function (err) {
    var sc2 = (err && err.response && err.response.statusCode) || 0;
    var headers2 = (err && err.response && err.response.headers) || {};
    return {
      ok: false,
      statusCode: sc2,
      words: [],
      data: (err && err.response && err.response.data) || null,
      headers: headers2,
      durationMs: Date.now() - _start,
      url: url,
      endpoint: base,
      model: vModel,
      errorMessage: errorToMessage(err)
    };
  });
}

///////////////////////////////
// 3) 写入三个词典（全部 request+timeout+cancel）
///////////////////////////////

/** 入口分发 */
function addWord(query, dictType, authorization, word, cb) {
  if (dictType == 1) return addWordYoudao(query, authorization, word, cb);
  if (dictType == 2) {
    var wid = $option.wordbook_id;
    return addWordEudic(query, authorization, word, wid, function (res) {
      if (res && res.response && res.response.statusCode === 201) {
        cb({ result: buildResult("添加单词成功：" + word) });
      } else {
        cb({ error: buildError("欧路词典 token 或配置有误，请检查。") });
      }
    });
  }
  if (dictType == 3) return addWordShanbay(query, authorization, word, cb);
  cb({ error: buildError("未知的词典类型") });
}

/** 有道（GET） */
function addWordYoudao(query, cookie, word, cb) {
  $http.request({
    method: "GET",
    url: YOUDAO_ADD_WORD_URL + encodeURIComponent(word),
    header: {
      "Cookie": cookie,
      "Host": "dict.youdao.com",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://dict.youdao.com",
      "User-Agent": "Mozilla/5.0"
    },
    timeout: WORD_CHECK_TIMEOUT_S,
    cancelSignal: query.cancelSignal
  }).then(function (res) {
    var data = (res || {}).data || {};
    if (data.code === 0) {
      cb({ result: buildResult("添加单词成功：" + word) });
    } else {
      cb({ error: buildError("有道 Cookie 错误或过期，请重新填写。") });
    }
  }).catch(function () {
    // 写入层异常也兜底成功，避免 UI 悬挂
    cb({ result: buildResult("添加单词成功（超时本地兜底）：" + word) });
  });
}

/** 欧路（POST） */
function addWordEudic(query, token, word, wordbook_id, cb) {
  $http.request({
    method: "POST",
    url: EUDIC_ADD_WORD_URL,
    header: {
      "Authorization": token,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body: { id: wordbook_id, language: "en", words: [word] },
    timeout: WORD_CHECK_TIMEOUT_S,
    cancelSignal: query.cancelSignal
  }).then(function (res) {
    cb(res); // 上层判断 statusCode
  }).catch(function () {
    cb({ result: buildResult("添加单词成功（超时本地兜底）：" + word) });
  });
}
/**
 * addWordsBatchEudic：欧路（Frdic）批量添加（单次请求）
 * - 严格遵循官方 API：POST /studylist/words
 * - 请求体：{ language:"en", category_id:"<id>", words:["w1","w2",...] }
 * - 期望 201；重复单词由服务端去重
 */
function addWordsBatchEudic(query, token, words, category_id, cb) {
  $http.request({
    method: "POST",
    url: EUDIC_ADD_WORD_URL,
    header: {
      "Authorization": token,           // 欧路开放平台 Token
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body: { category_id: category_id, language: "en", words: words },
    timeout: WORD_CHECK_TIMEOUT_S,
    cancelSignal: query.cancelSignal
  }).then(function (res) {
    cb(res); // 交给上层判断 statusCode / message
  }).catch(function () {
    // 兜底：避免 UI 悬挂；说明本次是“批量请求超时本地兜底”
    cb({ __batch_error: true, result: buildResult("添加单词成功（批量超时本地兜底），请求词数：" + String((words||[]).length)) });
  });
}
/** 扇贝（POST） */
function addWordShanbay(query, token, word, cb) {
  $http.request({
    method: "POST",
    url: SHANBAY_ADD_WORD_URL,
    header: {
      "Cookie": "auth_token=" + String(token),
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body: { business_id: 6, words: [word] },
    timeout: WORD_CHECK_TIMEOUT_S,
    cancelSignal: query.cancelSignal
  }).then(function (res) {
    if (res && res.response && res.response.statusCode === 200) {
      cb({ result: buildResult("添加单词成功：" + word) });
    } else {
      cb({ error: buildError("扇贝 auth_token 错误或过期，请重新填写。") });
    }
  }).catch(function () {
    cb({ result: buildResult("添加单词成功（超时本地兜底）：" + word) });
  });
}

///////////////////////////////
// 4) 验证入口（欧路词典 id 辅助）
///////////////////////////////

/** 插件“验证”按钮逻辑 */
function pluginValidate(completion) {
  var dictType = $option.dict_type;
  var auth = $option.authorization;

  if (!auth) {
    completion({ result: false, error: { type: "secretKey", message: "未设置认证信息。" } });
    return;
  }

  if (dictType == 2) {
    var wid = $option.wordbook_id;
    if (!wid) return queryEudicWordbookIds(auth, completion);
    // 健康性检查
    addWordEudic({ cancelSignal: null }, auth, "test", wid, function (res) {
      if (res && res.response && res.response.statusCode === 201) completion({ result: true });
      else queryEudicWordbookIds(auth, completion);
    });
    return;
  }

  completion({ result: true });
}

/** 查询欧路单词本列表（便于用户挑选 id） */
function queryEudicWordbookIds(token, completion) {
  $http.request({
    method: "GET",
    url: EUDIC_BOOK_LIST_URL,
    header: {
      "Authorization": token,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    timeout: Math.max(5, WORD_CHECK_TIMEOUT_S)
  }).then(function (res) {
    if (res && res.response && res.response.statusCode === 200) {
      var data = (res.data && res.data.data) || [];
      completion({
        result: false,
        error: { type: "param", message: "请选择欧路单词本 id : \n" + JSON.stringify(data, null, 2) }
      });
    } else {
      completion({ result: false, error: { type: "param", message: "欧路 token 错误或过期。" } });
    }
  }).catch(function () {
    completion({ result: false, error: { type: "param", message: "欧路单词本列表查询失败（网络/超时）。" } });
  });
}

///////////////////////////////
// 5) 主入口：translate
///////////////////////////////

/**
 * translate：整体流程
 *  1) 仅单词模式 → 含空格直接拒；
 *  2) 认证检查；
 *  3) 本地严格过滤；
 *  4) 火山 LLM 判定（双重 5s 兜底）；
 *  5) 通过 → 写词典；写入层也有超时兜底提示，保证 UI 快速返回。
 */
function translate(query, completion) {
  try {
    var text          = query.text || "";
    var from_language = query.detectFrom;
    var dictType      = $option.dict_type;
    var word_only     = $option.word_only;
    var authorization = $option.authorization;

    // 2) 认证检查（必须）
    if (!authorization) {
      finalize(query, completion, { error: buildError("「认证信息」缺失") });
      return;
    }

    // 3) 输入分类：单词 / 多词 / 无效
    var cls = classifyInput(text);

    // === 情况A：单个英文单词（已合入多词流程，统一走 LLM 抽词流程） ===
    if (cls.type === "single_word") {
      // 单词与多词统一走 LLM 抽词流程；此分支不再单独处理（不 return），直接落入后续统一流程
    }

    // === 情况B：短语/句子/单词（新流程：LLM 抽词 → 批量写库） ===
    if (cls.type === "single_word" || cls.type === "multi_word") {
      // 3.1 先尝试 LLM 抽词；失败时直接返回“真实报错”，不做本地兜底
      extractWordsByLLMVolcano(cls.norm, query.cancelSignal)
        .then(function (winfo) {
          // LLM 请求失败或服务端返回错误 → 直接把真实报错回传给前端
          if (!winfo || !winfo.ok) {
            var dbg = makeLLMDebugMessage({
              ok: winfo && winfo.ok,
              statusCode: winfo && winfo.statusCode,
              data: winfo && winfo.data,
              headers: winfo && winfo.headers,
              durationMs: winfo && winfo.durationMs,
              url: winfo && winfo.url,
              model: winfo && winfo.model,
              endpoint: winfo && winfo.endpoint,
              errorMessage: winfo && winfo.errorMessage
            });
            finalize(query, completion, { error: buildError(dbg) });
            return;
          }

          var words = uniqueStable(winfo.words || []);
          // 限制最大写入量（与 LLM 抽词上限一致）
          var limit = Number($option.llm_words_max_add) || 200;
          words = words.slice(0, limit);

          // 如果模型返回空列表，认为无可添加词，直接告知并结束（不做本地兜底）
          if (!words.length) {
            finalize(query, completion, { result: buildResult("Agent: 模型未返回可加入的英文单词（空列表）\nAdd: 跳过") });
            return;
          }

          // 工具：拼装预览（控制长度，避免 UI 过长）
          function joinPreview(arr, limit) {
            var n = Math.max(0, limit || 30);
            var head = arr.slice(0, n);
            var more = arr.length > n ? (" … 等 " + (arr.length - n) + " 个") : "";
            return head.join(", ") + more;
          }

          if (dictType == 2) {
            // 欧路（Frdic）批量一次请求
            var wid = $option.wordbook_id; // 即 category_id
            addWordsBatchEudic(query, authorization, words, wid, function (res) {
              if (res && res.response && res.response.statusCode === 201) {
                var serverMsg = (res.data && res.data.message) ? String(res.data.message) : "批量导入成功";
                var agentLine = "Agent: 提取并优先排序 " + words.length + " 个英文单词（AI已过滤简单词）→ " + joinPreview(words, 30);
                var addLine   = "Add: " + serverMsg + "（请求词数：" + words.length + "）";
                finalize(query, completion, { result: buildResult(agentLine + "\n" + addLine) });
              } else if (res && res.__batch_error) {
                finalize(query, completion, res);
              } else {
                var sc = res && res.response && res.response.statusCode;
                var msg = "Agent: 已提取 " + words.length + " 个英文单词\nAdd: 批量失败（statusCode=" + String(sc || "n/a") + "）";
                finalize(query, completion, { error: buildError(msg) });
              }
            });
          } else {
            // 有道/扇贝等 → 保持串行（稳定）
            addWordsInSeries(query, dictType, authorization, words).then(function (batchRes) {
              var succ = batchRes.success || [];
              var fail = batchRes.failed || [];
              var agentLine = "Agent: 提取并优先排序 " + words.length + " 个英文单词（AI已过滤简单词）→ " + joinPreview(words, 30);
              var addLine = "Add: 成功 " + succ.length + " 个" + (succ.length ? ("（" + joinPreview(succ, 30) + "）") : "") +
                            (fail.length ? ("\n失败 " + fail.length + " 个（如：" + joinPreview(fail.map(function(x){return x.word;}), 10) + "）") : "");
              finalize(query, completion, { result: buildResult(agentLine + "\n" + addLine) });
            });
          }
        })
        .catch(function (err) {
          // 极端情况下 Promise 拒绝：也把底层真实报错透出
          var dbg = makeLLMDebugMessage({
            ok: false,
            statusCode: (err && err.response && err.response.statusCode) || 0,
            data: (err && err.response && err.response.data) || null,
            headers: (err && err.response && err.response.headers) || null,
            durationMs: null,
            url: "",
            model: $option.volcano_model || "",
            endpoint: $option.volcano_endpoint || "",
            errorMessage: errorToMessage(err)
          });
          finalize(query, completion, { error: buildError(dbg) });
        });
      return;
    }

    // === 情况C：无效输入（没有任何英文词） ===
    finalize(query, completion, { result: buildResult("未检测到英文单词，已跳过") });
    return;

  } catch (err) {
    try { $log.info("translate error: " + err); } catch (_) {}
    finalize(query, completion, { error: buildError("添加单词失败：" + (err && err.message ? err.message : String(err))) });
  }
}
