const main_def = {
    detector: {
        func: main_parser,
        inputs: {}
    },
    links: {
        'Chapter Links': {
            func: chap_name_search,
            inputs: {
                'Link Regex': {type: 'text', default: '^\\s*\\S+'},
                'Query Selector': {type: 'selector', default: 'a', filters: ['UL', 'OL'], postfix: ' a'}
            }
        },
        'Novel Updates': {
            func: nu_toc_parser,
            inputs: {}
        },
        'cool18 Thread': {
            func: cool18_thread_links,
            inputs: {}
        },
    },
    text: {
        'Readability': {
            func: readability,
            inputs: {}
        },
        'Readability_Ex': {
            func: readability_ex,
            inputs: {}
        },
        'RawHTML':{
            func: rawChapter,
            inputs: {}
        },
        '69shuba': {
            func: shuba69_chapter,
            inputs: {}
        },
        'cool18 Thread Text': {
            func: cool18_thread_text,
            inputs: {}
        }
    }
}

/**
 * Gets metadata from html metadata
 * @param {string}url
 * @param {HTMLElement}dom
 * @returns {{
 * author: string,
 * description: string,
 * publisher: string,
 * title: string}}
 */
function meta_page(dom, url) {
    return {
        title: dom.title ?? "No Title",
        description: dom.querySelector('meta[name="description"]')?.content,
        author: "N/A",
        publisher: new URL(url).hostname
    }
}


/**
 * Gets metadata from Novel updates
 * @param {string}url
 * @param {HTMLElement}dom
 * @returns {{
 * author: string,
 * description: string,
 * publisher: string,
 * title: string}}
 */
function meta_nu(dom, url) {
    let tit = dom.querySelector(".seriestitlenu").innerText;
    let desc = dom.querySelector("#editdescription").innerHTML;
    let auth = dom.querySelector("#authtag").innerText;
    let img = dom.querySelector(".serieseditimg > img");
    if (img == null) {
        img = dom.querySelector(".seriesimg > img");
    }
    return {
        title: tit,
        description: desc,
        author: auth,
        cover: img.src,
        publisher: "Novel Update"
    }
}


/**
 * Gets metadata from 69shuba book pages
 * @param {HTMLElement} dom
 * @param {string} url
 * @returns {{title:string, description:string, author:string, cover:string, publisher:string}}
 */
function meta_69shuba(dom, url) {
    let scriptText = Array.from(dom.querySelectorAll('script'))
        .map(s => s.textContent).join('\n')
    let title = (scriptText.match(/articlename[n]?\s*:\s*'([^']+)'/) || [])[1]
    let author = (scriptText.match(/author\s*:\s*'([^']+)'/) || [])[1]
    let cover = dom.querySelector('.pic img')?.src ||
                dom.querySelector('.bookimg img')?.src
    let desc = dom.querySelector('.intro')?.innerHTML ||
               dom.querySelector('.describe')?.innerHTML
    return {
        title: title || dom.title,
        description: desc,
        author: author || 'N/A',
        cover: cover,
        publisher: '69书吧'
    }
}


/**
 * Auto detect function given url and source
 * @param inputs User inputs (if any)
 * @param url Page URL
 * @param source Page source
 * @param helpers Helpers
 * @returns
 */
function main_parser(inputs, url, source, helpers) {
    console.debug("Running main")
    let link = new URL(url);
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    let paths = link.pathname.split("/")
    switch (link.hostname) {
        case "www.novelupdates.com":
            if (paths.length > 1 && paths[1] === "series") {
                return {
                    message: 'Detected novel update.',
                    parser_opt: {type: 'links', parser: 'Novel Updates'},
                    meta: meta_nu(dom, url)
                }
            }
            return {failed_message: "Please load specific series before running."}
        case "www.wuxiaworld.com":
            if (paths.length > 3 && paths[1] === 'novel') {
                return {
                    message: 'Detected Wuxia World (use Add Page).',
                    webtype: 'spa',
                    meta: meta_page(dom, url),
                    parser_opt: {type: 'text', parser: 'Readability'},
                    add_opt: {
                        next_sel: '.MuiButton-root:nth-child(2)',
                        title_sel: '.font-set-b18', scroll_end: true
                    }
                }
            }
            return {failed_message: "Please load first chapter of novel"}
        case "www.royalroad.com":
            return {
                message: 'Detected Royalroad.',
                meta: {
                    title: dom.title ?? "No Title",
                    description: dom.querySelector('meta[name="description"]')?.content,
                    author: dom.querySelector('span > .font-white').innerText ?? "No author",
                    publisher: new URL(url).hostname,
                    cover: dom.querySelector('.fic-header img')?.src,
                },
                parser_opt: {
                    type: 'links', parser: 'Chapter Links',
                    parser_inputs: {
                        'Query Selector': '.chapter-row > td:nth-child(1) > a',
                        'Link Regex': '.*'
                    }
                }
            }
        case "news.ycombinator.com":
            // Just for some testing
            if (link.pathname === '/' || (paths[1].startsWith("?p="))) {
                return {
                    message: 'Detected YCombinator.',
                    meta: meta_page(dom, url),
                    parser_opt: {
                        type: 'links', parser: 'Chapter Links',
                        parser_inputs: {
                            'Query Selector': '.titleline > a',
                            'Link Regex': '.*'
                        }
                    }
                }
            }
            return {failed_message: "Please only load on front page(s)."}
        case "www.reddit.com":
            // Just for some testing
            return {
                message: 'Detected Reddit.',
                meta: meta_page(dom, url),
                parser_opt: {
                    type: 'links', parser: 'Chapter Links',
                    parser_inputs: {
                        'Query Selector': '.SQnoC3ObvgnGjWt90zD9Z',
                        'Link Regex': '.*'
                    }
                }
            }
        case "www.69shuba.com":
            if (paths.length > 1 && paths[1] === 'book') {
                let isDetailPage = paths[2] && paths[2].includes('.htm')
                let msg = isDetailPage
                    ? '检测到69书吧（书籍详情页）。建议先点击「完整目录」进入目录页以获取全部章节，文本解析器请选择「69shuba」。'
                    : '检测到69书吧目录页，正在解析全部章节链接。文本解析器请选择「69shuba」。'
                return {
                    message: msg,
                    meta: meta_69shuba(dom, url),
                    parser_opt: {
                        type: 'links',
                        parser: 'Chapter Links',
                        chap_parser: '69shuba',
                        parser_inputs: {
                            'Query Selector': 'a[href*="/txt/"]',
                            'Link Regex': '\\S'
                        }
                    }
                }
            }
            return {failed_message: '请在69书吧小说书籍页（/book/XXXXX.htm 或 /book/XXXXX/）运行。'}
        case "www.cool18.com":
            if (link.searchParams.get("act") === "threadview") {
                let c18_title = ((dom.querySelector('h1.main-title')?.textContent ?? '').trim())
                    || (dom.title || "No Title");
                let c18_author = dom.querySelector('meta[name="author"]')?.content
                    ?? dom.querySelector('.sender a')?.innerText ?? "N/A";
                return {
                    message: '检测到 cool18 论坛帖子，将抓取本帖及目录中链接的分帖。',
                    meta: {
                        title: c18_title,
                        description: dom.querySelector('meta[name="description"]')?.content,
                        author: c18_author,
                        publisher: "cool18"
                    },
                    parser_opt: {
                        type: 'links', parser: 'cool18 Thread',
                        chap_parser: 'cool18 Thread Text'
                    }
                }
            }
            return {failed_message: '请在 cool18 论坛帖子页（act=threadview）运行。'}
    }
    if (dom.querySelector('.md-nav--primary>.md-nav__list>.md-nav__item--active > .md-nav')) {
        return {
            message: 'Detected Material for Mkdoc Doc.',
            meta: meta_page(dom, url),
            parser_opt: {
                type: 'links', parser: 'Chapter Links',
                parser_inputs: {
                    'Query Selector': '.md-nav--primary>.md-nav__list>.md-nav__item--active > .md-nav > .md-nav__list > .md-nav__item > a',
                    'Link Regex': '.*'
                }
            }
        }
    }
    // Look for common nav items
    for (let n of ['.wy-menu','.bd-sidenav', '.current .toctree-l1','.toctree-l1', '.nav-list']) {
        console.debug(" Check", n)
        if (dom.querySelector(n) !== null) {
            // Tries to detect vanilla readthedocs
            return {
                message: 'Detected nav menu (' + n + ').',
                meta: meta_page(dom, url),
                parser_opt: {
                    type: 'links', parser: 'Chapter Links',
                    parser_inputs: {
                        'Query Selector': n + ' a',
                        'Link Regex': '.*'
                    }
                }
            }
        }
    }
    return {failed_message: "No automatic parser available for: " + link.hostname}
}

/**
 * Search for chapter by link names
 * @param {{'Query Selector':string,'Link Regex':string}} inputs
 * @param {string} url
 * @param {string} source
 * @param {{}} helpers
 * @returns {{chaps: *[], message: string}}
 */
function chap_name_search(inputs,
                          url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    let ancs = dom.querySelectorAll(inputs['Query Selector']);
    let chaps = []
    const chap_reg = new RegExp(inputs['Link Regex'], 'i')
    let i = 0
    ancs.forEach((element) => {
        if (chap_reg.test(element.innerText)) {
            chaps.push({
                id: i++,
                url: element.href,
                title: element.innerText
            });
        }
    });
    return {
        chaps: chaps,
        message: 'Parsing links with prefix chapter (' + chaps.length + ' chapters)'
    };
}


/**
 * Parse novel update series
 * @param inputs Inputs
 * @param url Series URL
 * @param source Source text
 * @param helpers Help functions
 * @returns
 */
function nu_toc_parser(inputs, url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    let chaps = [];

    let chap_popup = dom.querySelector("#my_popupreading");
    let parser_msg = "Please expand all chapters!"
    if (chap_popup != null) {
        let chap_lis = chap_popup.querySelectorAll("a");
        let i = 0
        chap_lis.forEach((element) => {
            if (element.href.includes("extnu")) {
                chaps.unshift({
                    id: i++,
                    url: element.href,
                    title: element.innerText.trim()
                });
            }
        });
        if (chaps.length > 0) {
            parser_msg = 'Page parsed as Novel Update Series (' + chaps.length + ' chapters)'
        }
    }
    return {
        chaps: chaps, message: parser_msg
    };
}

/**
 * Parse using readability
 * @param inputs
 * @param url
 * @param source
 * @param helpers
 * @returns {{html, title, message: string}}
 */
function readability(inputs, url, source, helpers) {
    let parser = new DOMParser();
    console.log(source)
    let dom = parser.parseFromString(source, "text/html");
    let out = helpers["readability"](dom);
    // Generic parser
    return {
        title: out.title,
        html: out.content,
        message: "Parsed simple chapter"
    };
}

function rawChapter(inputs, url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    dom.querySelectorAll("img[src]").forEach(
        e=>console.log(e.getAttribute('src')))
    let out = dom.body.outerHTML;
    // Generic parser
    return {
        title: out.title,
        html: out.content,
        message: "Parsed simple chapter"
    };
}


/**
 * Parse 69shuba chapter page
 * Chapter content is inside <div class="txtnav"> after stripping nav/ad elements
 * @param inputs
 * @param url
 * @param source
 * @param helpers
 * @returns {{html:string, title:string, message:string}}
 */
function shuba69_chapter(inputs, url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, 'text/html');
    // JS chaptername is always clean (no site suffix); fall back to h1, then page title
    let scriptText = Array.from(dom.querySelectorAll('script'))
        .map(s => s.textContent).join('\n');
    let title = (scriptText.match(/chaptername\s*:\s*'([^']+)'/) || [])[1]?.trim()
        || dom.querySelector('.txtnav h1')?.textContent?.trim()
        || dom.title.replace(/[-_\s]*69书吧\s*$/i, '').trim();

    let txtnav = dom.querySelector('.txtnav');
    if (!txtnav) {
        let out = helpers['readability'](dom);
        if (!out) return {title: title || url, html: '<div>章节加载失败（可能被 Cloudflare 拦截）</div>', message: '403 或页面解析失败'};
        return {title: out.title || title || url, html: out.content, message: '解析69书吧章节（readability）'};
    }

    // Remove non-content elements: ads, nav, title, date info
    txtnav.querySelectorAll(
        'h1, .txtinfo, #txtright, .tools, .yueduad1, script, .bottom_page, .pagebox, .bottom_ad'
    ).forEach(el => el.remove());

    // 69shuba puts &nbsp;&nbsp; indent at START of each paragraph (before text, not after <br>).
    // Split on <br>, strip leading whitespace/nbsp from each segment, then rejoin.
    let html = txtnav.innerHTML
        .split(/<br\s*\/?>/i)
        .map(seg => seg.replace(/^(?:\s|&nbsp;|&#160;|&emsp;|&#8195;|&#12288;|[\u00a0\u2003\u3000])+/, ''))
        .join('<br/>');

    return {
        title: title,
        html: '<div>' + html + '</div>',
        message: '已解析69书吧章节'
    };
}

/**
 * Builds a sort key from a cool18 TOC link text, e.g.
 * "【书名】（7-8）" -> {num: 7, extra: 0, part: 0}
 * "【书名】（5上）" -> {num: 5, extra: 0, part: 0}
 * "【书名】（5下）" -> {num: 5, extra: 0, part: 2}
 * "【书名】（番外篇 20-21）" -> {num: 20, extra: 1, part: 0}
 * Full-width digits are normalized first. Numbers inside （…）/（…）
 * are preferred (so "第三卷（108）" sorts by 108, not 3); ranges like
 * "7-8" sort by their start. extra (番外/外传) sorts after the main
 * story; part orders 上 < 中 < 下 within the same number.
 * @param {string} text Link text
 * @returns {{num: number, extra: number, part: number}}
 */
function c18_part_key(text) {
    let t = (text || '').replace(/[\uFF10-\uFF19]/g,
        c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    let bm = t.match(/[（(]([^（）()]*\d[^（）()]*)[）)]/);
    let scope = bm ? bm[1] : t;
    let num = Infinity;
    let nm = scope.match(/\d{1,4}(?:\s*[-–—~～\uFF0D]\s*\d{1,4})?/);
    if (nm) num = parseInt(nm[0], 10);
    return {
        num: num,
        extra: /番外|外传/.test(t) ? 1 : 0,
        part: /下/.test(scope) ? 2 : (/中/.test(scope) ? 1 : 0)
    };
}

/**
 * cool18 forum thread: the current thread plus every part thread linked in
 * the post's TOC (threadview links inside the #content-section <pre>, only
 * before the first 第X章/节/回 heading) become book chapters, ordered by
 * part number ascending: main story first, then 番外/外传, unnumbered
 * links keep their original order last; 上 < 中 < 下 within the same
 * number. TOC links are often listed newest-first (descending) or jumbled
 * (番外 interleaved with the main story), hence the key-based sort.
 * @param inputs Inputs
 * @param url Thread URL
 * @param source Source text
 * @param helpers Help functions
 * @returns {{chaps: *[], message: string}}
 */
function cool18_thread_links(inputs, url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    let title = ((dom.querySelector('h1.main-title')?.textContent ?? '').trim())
        || (dom.title || "cool18 thread");
    let chaps = [{id: 0, url: url, title: title}];
    let pre = dom.querySelector('#content-section pre')
        ?? dom.querySelector('.post-content .content-section pre')
        ?? dom.querySelector('.post-content pre')
        ?? dom.querySelector('pre');
    let self_tid = (url.match(/[?&]tid=(\d+)/) || [])[1];
    let items = [];
    if (pre) {
        let seen = new Set();
        let body_started = false;
        let walk = (node) => {
            if (node.nodeType === 3) { // #text
                if (/^第[0-9一二三四五六七八九十百千两]+[章节回]/.test(
                        (node.nodeValue || '').trim())) {
                    body_started = true;
                }
            } else if (node.nodeType === 1) { // element
                let tag = node.tagName.toLowerCase();
                if (tag === 'a') {
                    if (!body_started
                        && (node.getAttribute('href') || '').includes('threadview')) {
                        let tid = (node.href.match(/[?&]tid=(\d+)/) || [])[1];
                        let t = (node.textContent || '').trim();
                        if (tid && tid !== self_tid && !seen.has(tid)) {
                            seen.add(tid);
                            items.push({
                                url: node.href,
                                title: t || ('章节 ' + (items.length + 1)),
                                k: c18_part_key(t)
                            });
                        }
                    }
                    return;
                }
                node.childNodes.forEach(walk);
            }
        };
        pre.childNodes.forEach(walk);
        items.sort((x, y) =>
            (x.k.extra - y.k.extra)
            || (x.k.num - y.k.num)
            || (x.k.part - y.k.part));
        for (let it of items) {
            chaps.push({id: chaps.length, url: it.url, title: it.title});
        }
    }
    return {
        chaps: chaps,
        message: 'cool18 帖子解析为 ' + chaps.length + ' 章'
            + (items.length ? '（当前帖 + 目录分帖 ' + items.length + '）' : '（单帖）')
    };
}

/**
 * cool18 forum thread: extract the post body from the #content-section
 * <pre> block and turn it into clean <p> paragraphs. Newlines and
 * <p>/<br> tags act as paragraph breaks; inline <a>/<img> are kept.
 * @param inputs Inputs
 * @param url Thread URL
 * @param source Source text
 * @param helpers Help functions
 * @returns {{title: string, html: string, message: string}}
 */
function cool18_thread_text(inputs, url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    let title = ((dom.querySelector('h1.main-title')?.textContent ?? '').trim())
        || (dom.title || "cool18 thread");
    let pre = dom.querySelector('#content-section pre')
        ?? dom.querySelector('.post-content .content-section pre')
        ?? dom.querySelector('.post-content pre')
        ?? dom.querySelector('pre');
    if (pre == null) {
        return {
            title: title,
            html: '<p>(未找到正文)</p>',
            message: 'cool18: 未找到正文区域。'
        };
    }
    let paras = [];
    let cur = [];
    let flush = () => {
        let line = cur.join('').replace(/\u00a0/g, ' ').trim();
        if (line !== '') paras.push(line);
        cur = [];
    };
    let walk = (node) => {
        if (node.nodeType === 3) { // #text
            let segs = node.nodeValue.split(/\r?\n/);
            for (let i = 0; i < segs.length; i++) {
                if (i > 0) flush();
                cur.push(segs[i]);
            }
        } else if (node.nodeType === 1) { // element
            let tag = node.tagName.toLowerCase();
            if (tag === 'br') {
                flush();
            } else if (tag === 'p' || tag === 'div') {
                flush();
                node.childNodes.forEach(walk);
            } else if (tag === 'a') {
                cur.push(node.outerHTML);
            } else if (tag === 'img') {
                let el = node.cloneNode(false);
                let s = el.getAttribute('src');
                if (s) {
                    try { el.setAttribute('src', new URL(s, url).href); }
                    catch (e) { /* keep as-is */ }
                }
                cur.push(el.outerHTML);
            } else {
                node.childNodes.forEach(walk);
            }
        }
    };
    pre.childNodes.forEach(walk);
    flush();
    // The novel body starts at the first chapter heading (第X章/节/回/部分).
    // Everything before it (per-post title / 作者 / 字数 / TOC links) is
    // dropped so it is not repeated in every chapter of the book. When no
    // heading is present, fall back to stripping leading header lines.
    let bodyStart = paras.findIndex(p =>
        /^\s*第[0-9一二三四五六七八九十百千两]+(?:\s*[-–—~～\uFF0D－]\s*[0-9一二三四五六七八九十百千两]+)?\s*[章节回部分]/.test(p));
    let start;
    if (bodyStart >= 0) {
        start = bodyStart;
    } else {
        let is_header_para = (p) =>
            (/^<a[\s>]/.test(p) && p.includes('threadview'))
            || /^作者[：:]/.test(p)
            || /^字数[：:]/.test(p)
            || /^【[^】]+】.*[（(]\d{1,4}/.test(p);
        start = 0;
        while (start < paras.length && is_header_para(paras[start].trim())) start++;
        if (start === paras.length) start = 0; // all looked like header: keep as-is
    }
    let html = paras.slice(start).map(s => '<p>' + s + '</p>').join('\n');
    return {
        title: title,
        html: html,
        message: '已解析 cool18 帖子 (' + paras.length + ' 段)'
    };
}


/**
 * Parse using extended readability logic
 * @param inputs
 * @param url
 * @param source
 * @param helpers
 * @returns {Promise<{html: string, title: string, message: string}>}
 */
async function readability_ex(inputs, url, source, helpers) {
    let parser = new DOMParser();
    let dom = parser.parseFromString(source, "text/html");
    let new_link = null;
    let subchaps = [];

    // Wordpress content
    let main_cont = dom.querySelector(".entry-content")
    if (helpers["readerable"](dom, {"minContentLength": 1000})) {
        console.log("Readable");
        let out = helpers["readability"](dom);
        return {
            title: out.title,
            html: out.content,
            message: "Parsed normal chapter.",
        };
    } else if (main_cont != null) {
        console.log("Checking for intro page/subchapt");
        let ancs = main_cont.querySelectorAll("a");
        ancs.forEach((element) => {
            if (RegExp(/click here to read|read here|continue reading/i).test(element.innerText)) {
                console.log("Intro page found");
                new_link = element.href;
            } else if (RegExp(/^chapter|^part/i).test(element.innerText)) {
                console.log("Subchapters found");
                subchaps.push(element.href)
            }
        });
    }
    if (new_link != null) {
        let res = await fetch(new_link);
        let r_txt = await res.text();
        dom = parser.parseFromString(r_txt, "text/html");
        let out = helpers["readability"](dom);
        return {
            title: out.title,
            html: out.content,
            message: "Parsed redirected chapter",
        };
    } else if (subchaps.length > 0) {
        let html = "";
        let title = "";
        for (let subc in subchaps) {
            console.log(subchaps[subc]);
            let cres = await fetch(subchaps[subc]);
            let c_txt = await cres.text();
            let cdom = parser.parseFromString(c_txt, "text/html");
            let out = helpers["readability"](cdom);
            if (title === "") {
                title = out.title + "...(more)"
            }
            html += "<h1>" + out.title + "</h1>" + out.content
        }
        return {
            title: title,
            html: html,
            message: "Parsed sub chapters",
        };
    }
    let out = helpers["readability"](dom);
    return {
        title: out.title,
        html: out.content,
        message: "Parsed short chapter",
    };
}

