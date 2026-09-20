import {parse} from "content-type"
import SandboxInput from ".././messaging/SandboxInput";
import {
  get_default_inputs, ParserDetected,
  ParserLoadResult,
  ParserParams,
  ParserResultChap,
  ParserResultDetector,
  ParserResultLinks
} from "./parser_types";
import {MsgCommand, MsgOut, SbxInRunFunc, SbxInRunFuncRes} from "../messaging/msg_types";
import {Chapter} from "../novel/novel_data";
import {Ref} from "vue";
import OptionsManager from "../common/OptionsMan";
import * as Parallel from "async-parallel";
import {
  next_id,
  p_inputs_val_link,
  p_inputs_val_text,
  page_type,
  parser,
  parser_chap, scroll,
  title_id
} from "../../pages/parser_state";
import {chaps, meta} from "../../pages/novel_state";
import {write_info} from "../../pages/sidebar/sidebar_utils";
import {msg_sendwin} from "../../pages/win_state";
import {get_origin} from "../dom/SidebarContainer";
import browser from "webextension-polyfill";

// Max times a single chapter will wait for a Cloudflare challenge to clear
const CF_MAX_CLEARS = 3
// How often to re-check whether the challenge has cleared
const CF_POLL_MS = 5000
// Silent wait (no popup) before asking the user to pass the check
const CF_SILENT_MS = 10 * 1000
// Longer silent wait when a check was cleared only moments ago
const CF_SILENT_AFTER_CLEAR_MS = 60 * 1000
const CF_RECENT_CLEAR_MS = 3 * 60 * 1000
// Give up waiting for the user after this long
const CF_WAIT_LIMIT_MS = 10 * 60 * 1000
// Adaptive request spacing after challenges (ms)
const CF_PACE_MIN_MS = 2000
const CF_PACE_MAX_MS = 15000

const sleep = (ms: number) => new Promise(f => setTimeout(f, ms))

interface FetchedPage {
  status: number
  url: string
  content_type: string | null
  cf_mitigated: string | null
  raw: ArrayBuffer
}


export default class ParserManager {
  private parsers_str: Record<string, string> = {}
  private options: OptionsManager
  private sandbox: SandboxInput
  private parsers: Record<string, ParserLoadResult> = {}
  // Shared by all download workers so only one challenge tab is opened at a time
  private cf_gate: Promise<boolean> | null = null
  private cf_last_clear = 0
  // Adaptive minimum spacing between request starts, grows on each challenge
  private pace_ms = 0
  private next_slot = 0
  private ok_streak = 0

  constructor(sandbox: SandboxInput) {
    this.options = OptionsManager.Instance
    this.sandbox = sandbox
  }

  /**
   * Gets text definitions for all
   */
  get_parse_docs() {
    return this.parsers_str
  }

  /**
   * Loads a single parser definition into sandbox
   * @param key
   * @param body
   */
  async load_parser(key: string, body: string): Promise<ParserLoadResult> {
    const func_in: SbxInRunFunc = {
      body: body + "\nreturn main_def",
      res_key: key
    }
    const res = await this.sandbox
      .run_in_sandbox<SbxInRunFunc, ParserLoadResult>(
        {
          command: MsgCommand.SbxRunFunc,
          data: func_in
        })
    this.parsers[key] = (res.data as ParserLoadResult)
    return res.data!
  }

  /**
   * Load all parser definitions into sandbox
   */
  async load_all_parsers(): Promise<Record<string, ParserLoadResult>> {
    console.log("Loading parsers.")
    this.parsers_str =
      await this.options.get_parsers_definitions()
    for (let k in this.parsers_str) {
      await this.load_parser(k, this.parsers_str[k])
    }
    return Promise.resolve(this.parsers)
  }

  get_title_res(source: string) {
    const parser = new DOMParser()
    const dom = parser.parseFromString(source, "text/html");
    let title_res = null
    if (title_id.value != '') {
      const title_el = dom.querySelector(title_id.value)
      if (title_el == null) {
        write_info("Unable to find title element")
      } else {
        title_res = title_el.textContent
      }
    }
    return title_res
  }

  /**
   * Runs initial detector and then detected parser
   * @param url URL of page
   * @param src Source of page
   * @param parse_doc Parser doc
   */
  async run_init_parser(url: string, src: string, parse_doc: string
  ) {
    // Run detector
    const det_res = (await this.sandbox
      .run_in_sandbox<SbxInRunFuncRes, ParserResultDetector>({
        command: MsgCommand.SbxRunFuncRes,
        data: {
          res_key: parse_doc,
          inputs: [{}, url, src],
          subkeys: ["detector", "func"]
        }
      }, 2, 0))
    const det_data = det_res.data!

    if (det_data.meta !== undefined) {
      meta.value = det_data.meta
    }

    page_type.value = det_data.webtype ?? "pages"
    next_id.value = det_data.add_opt?.next_sel ?? ''
    title_id.value = det_data.add_opt?.title_sel ?? ''
    scroll.value = det_data.add_opt?.scroll_end ?? false

    let parser_opt: ParserDetected = det_data.parser_opt ?? {
      type: 'links',
      parser: Object.keys(this.parsers[parse_doc]['links'])[0]
    }

    let det_inputs = parser_opt.parser_inputs ?? get_default_inputs(
      this.parsers[parse_doc][parser_opt.type][parser_opt.parser]['inputs'])


    // Set detected option
    if (parser_opt.type == "links") {
      parser.value = {
        doc: parse_doc,
        parser: parser_opt.parser,
      }
      p_inputs_val_link.value = det_inputs

      parser_chap.value = {
        doc: parse_doc,
        parser: parser_opt.chap_parser || Object.keys(this.parsers[parse_doc].text)[0]
      }
      p_inputs_val_text.value = get_default_inputs(this.parsers[parse_doc]
        .text[parser_chap.value.parser]['inputs'])
    } else {
      parser_chap.value = {
        doc: parse_doc,
        parser: parser_opt.parser
      }
      p_inputs_val_text.value = det_inputs

      parser.value = {
        doc: parse_doc,
        parser: Object.keys(this.parsers[parse_doc].links)[0]
      }
      p_inputs_val_link.value = get_default_inputs(this.parsers[parse_doc]
        .links[parser.value.parser]['inputs'])
    }

    if (det_data.failed_message !== undefined) {
      throw new Error(det_data.failed_message)
    }

    if (parser_opt.type == 'links') {
      // Run detected parser
      const parse_res = await this.sandbox
        .run_in_sandbox<SbxInRunFuncRes, ParserResultLinks | ParserResultChap>({
          command: MsgCommand.SbxRunFuncRes,
          data: {
            res_key: parse_doc,
            inputs: [det_inputs, url, src],
            subkeys: [parser_opt.type, parser_opt.parser, 'func']
          }
        }, 2, 0)
      write_info(det_res.message + "\n" + parse_res.message)
      chaps.value = (parse_res.data! as ParserResultLinks).chaps
    } else {
      write_info(det_res.message)
    }
  }

  /**
   * Runs link parser
   * @param params Parameters fro parser
   * @param parse_doc Parser doc
   * @param parser Parser
   */
  async run_links_parse(params: ParserParams, parse_doc: string, parser: string)
    : Promise<MsgOut<ParserResultLinks>> {
    return await this.sandbox
      .run_in_sandbox<SbxInRunFuncRes, ParserResultLinks>({
        command: MsgCommand.SbxRunFuncRes,
        data: {
          res_key: parse_doc,
          inputs: [params.inputs, params.url, params.src],
          subkeys: ["links", parser, 'func']
        }
      }, 2, 0)
  }

  /**
   * Runs chapter parser
   * @param params Parameters for parser
   * @param parse_doc Parser doc
   * @param parser Parser
   */
  async run_chap_parser(
    params: ParserParams, parse_doc: string, parser: string,
  ): Promise<MsgOut<ParserResultChap>> {
    return await this.sandbox.run_in_sandbox<SbxInRunFuncRes, ParserResultChap>(
      {
        command: MsgCommand.SbxRunFuncRes,
        data: {
          res_key: parse_doc,
          inputs: [params.inputs, params.url, params.src],
          subkeys: ["text", parser, "func"]
        }
      }, 1, 0)
  }

  parseContentType(contentType: string):string|undefined {
    try {
      return parse(contentType).parameters.charset;
    } catch {
      return undefined;
    }
  }

  getCharset(content: ArrayBuffer, headers?: Headers):string {
    // See http://www.w3.org/TR/2011/WD-html5-20110113/parsing.html#determining-the-character-encoding
    const decoder = new TextDecoder('utf-8');

    // Try to extract content-type header
    const contentType = headers?.get('content-type');
    if (contentType) {
      const hdr_charset = this.parseContentType(contentType);
      if (hdr_charset) {
        return hdr_charset;
      }
    }

    // No charset in content type, peek at response body for at most 1024 bytes
    const data = decoder.decode(content.slice(0, 1024))

    // HTML5, HTML4 and XML
    if (data) {

      const rawdom = new DOMParser().parseFromString(data, "text/html")
      const html5_cs = rawdom.querySelector('meta[charset]')
        ?.getAttribute('charset') ?? null
      if (html5_cs !== null){
        // <meta charset="gbk"> gives a bare charset value, use it directly
        return html5_cs.toLowerCase()
      }

      const html4_cs = rawdom.querySelector('meta[http-equiv=Content-Type]')
        ?.getAttribute('content') ?? null
      if (html4_cs !== null){
        // <meta http-equiv="Content-Type" content="text/html; charset=gbk">
        const res = this.parseContentType(html4_cs)
        if (res)
          return res
      }
    }

    return 'utf-8'
  }

  /**
   * Detects a Cloudflare challenge / block page ("Just a moment...")
   */
  is_cf_challenge(page: FetchedPage): boolean {
    if (page.cf_mitigated === 'challenge') return true
    const head = new TextDecoder('utf-8').decode(page.raw.slice(0, 4096))
    if (/<title>\s*(just a moment|attention required)/i.test(head)) return true
    return [403, 429, 503].includes(page.status)
      && /cf-chl|challenge-platform|cf-browser-verification/i.test(head)
  }

  /**
   * Fetches a page. Same-site pages are fetched from inside the page being
   * browsed (looks like normal browsing to Cloudflare); anything else falls
   * back to a fetch from the extension.
   */
  private async fetch_page(url: string): Promise<FetchedPage> {
    let same_origin = false
    try {
      same_origin = new URL(url).origin === get_origin()
    } catch (e) {
    }
    if (same_origin) {
      try {
        const r = await msg_sendwin.send_message<{ url: string }, any>(
          {command: MsgCommand.ContFetch, data: {url}}, 1, 0)
        const d = r.data
        const bin = atob(d.body_b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return {
          status: d.status, url: d.url, content_type: d.content_type,
          cf_mitigated: d.cf_mitigated, raw: bytes.buffer
        }
      } catch (e) {
        console.warn("Fetch in page failed, falling back to extension fetch", e)
      }
    }
    const res = await fetch(url, {credentials: 'include'})
    return {
      status: res.status, url: res.url,
      content_type: res.headers.get('content-type'),
      cf_mitigated: res.headers.get('cf-mitigated'),
      raw: await res.arrayBuffer()
    }
  }

  /**
   * Spaces out request starts once Cloudflare has started challenging us
   */
  private async throttle() {
    if (this.pace_ms <= 0) return
    const now = Date.now()
    const start = Math.max(now, this.next_slot)
    this.next_slot = start + this.pace_ms
    if (start > now) await sleep(start - now)
  }

  private note_success() {
    if (this.pace_ms > 0 && ++this.ok_streak >= 20) {
      this.ok_streak = 0
      this.pace_ms = this.pace_ms / 2 < 1000 ? 0 : this.pace_ms / 2
    }
  }

  private async poll_clear(url: string, limit_ms: number, cancel: Ref<boolean>): Promise<boolean> {
    const start = Date.now()
    while (!cancel.value && Date.now() - start < limit_ms) {
      await sleep(CF_POLL_MS)
      try {
        const page = await this.fetch_page(url)
        if (page.status < 400 && !this.is_cf_challenge(page)) return true
      } catch (e) {
        // Network hiccup, keep polling
      }
    }
    return false
  }

  /**
   * Called when a chapter is challenged. Pauses all downloads, slows down,
   * waits silently first (rate-limit style blocks expire), and only then opens
   * the page in a tab for the user to pass the check.
   * @returns true once cleared, false if cancelled / timed out
   */
  private wait_cf_clear(url: string, cancel: Ref<boolean>, status_cb: Function): Promise<boolean> {
    if (this.cf_gate !== null) return this.cf_gate
    const gate = (async () => {
      this.ok_streak = 0
      this.pace_ms = Math.min(Math.max(this.pace_ms * 2, CF_PACE_MIN_MS), CF_PACE_MAX_MS)
      const recent = Date.now() - this.cf_last_clear < CF_RECENT_CLEAR_MS
      const silent_ms = recent ? CF_SILENT_AFTER_CLEAR_MS : CF_SILENT_MS
      status_cb("Cloudflare 限制访问，暂停 " + Math.round(silent_ms / 1000)
        + " 秒后重试，之后请求会放慢 (Rate limited by Cloudflare, pausing)")
      if (await this.poll_clear(url, silent_ms, cancel)) {
        this.cf_last_clear = Date.now()
        return true
      }
      if (cancel.value) return false

      let tab_id: number | undefined
      try {
        tab_id = await browser.runtime.sendMessage({cmd: "open_tab", url})
      } catch (e) {
        console.warn("Unable to open verification tab", e)
      }
      status_cb("Cloudflare 拦截：请在新打开的标签页中完成验证，完成后将自动继续 "
        + "(Blocked by Cloudflare, please complete the check in the opened tab)")
      try {
        const cleared = await this.poll_clear(url, CF_WAIT_LIMIT_MS, cancel)
        if (cleared) {
          this.cf_last_clear = Date.now()
          status_cb("Cloudflare check cleared, resuming at reduced speed")
        }
        return cleared
      } finally {
        if (tab_id !== undefined) {
          browser.runtime.sendMessage({cmd: "close_tab", tab_id}).catch(() => {
          })
        }
      }
    })()
    this.cf_gate = gate
    gate.finally(() => {
      this.cf_gate = null
    })
    return gate
  }

  async fix_html(htmlRaw:ArrayBuffer,cs:string, url: string): Promise<string> {
    console.log(cs)
    const decoder = new TextDecoder(cs);
    const html = decoder.decode(htmlRaw);
    console.log(html)
    let parser = new DOMParser();
    let s = new XMLSerializer();
    let html_node = parser.parseFromString(html, "text/html");


    if (html_node.head.getElementsByTagName('base').length == 0) {
      let baseEl = html_node.createElement('base');
      baseEl.setAttribute('href', url);
      html_node.head.appendChild(baseEl)
    }
    return s.serializeToString(html_node);
  }

  async parser_chaps(parse_doc: string,
                     parser: string,
                     chaps_ref: Ref<Chapter[]>,
                     threads: number,
                     wait_s: number,
                     cancel: Ref<boolean>,
                     status_cb: Function,
                     progress_val: Ref<number>) {

    let cnt_slice = (100.0 / chaps_ref.value.length);
    progress_val.value = 0;
    const parse_man = this
    let extract_chap = async function (id: number) {
      status_cb("Chapter " + id.toString())
      if (cancel.value) {
        throw new Error('User cancelled')
      }
      if (chaps_ref.value[id].url !== undefined) {
        const chap_url = chaps_ref.value[id].url
        let page: FetchedPage
        let clears = 0
        while (true) {
          // Hold new requests while a challenge is being resolved
          if (parse_man.cf_gate !== null) await parse_man.cf_gate
          await parse_man.throttle()
          try {
            page = await parse_man.fetch_page(chap_url)
          } catch (e) {
            status_cb("Can't download. Please check permissions in extension page "
              + "-> permission -> Access your data for all websites")
            return
          }
          if (!parse_man.is_cf_challenge(page)) break
          if (cancel.value) {
            throw new Error('User cancelled')
          }
          if (clears++ >= CF_MAX_CLEARS
            || !await parse_man.wait_cf_clear(chap_url, cancel, status_cb)) {
            status_cb("Chapter " + id + " blocked by Cloudflare, skipped. "
              + "Re-select it and parse again after passing the check.")
            return
          }
        }
        parse_man.note_success()
        const hdrs = new Headers()
        if (page.content_type) hdrs.set('content-type', page.content_type)
        const chars = parse_man.getCharset(page.raw, hdrs)
        const fixed_html = await parse_man.fix_html(page.raw, chars, page.url);
        chaps_ref.value[id].html = fixed_html
        status_cb("Parsing chapter content: " + id)
        const chap_res =
          await parse_man.run_chap_parser({
            inputs: {},
            url: chaps_ref.value[id].url,
            src: fixed_html
          }, parse_doc, parser)
        chaps_ref.value[id].html_parsed = chap_res.data?.html ?? ""
        chaps_ref.value[id].title = chap_res.data?.title ?? ""
      }
      progress_val.value += cnt_slice;
      await new Promise(f => setTimeout(f, wait_s * 1000));
    }
    try {
      await Parallel.each(Array.from(Array(chaps_ref.value.length).keys()),
        extract_chap,
        threads);
      progress_val.value = 0
    } catch (e: any) {
      status_cb(e)
      for (let item of e.list) {
        status_cb(item)
      }
    }
  }
}
