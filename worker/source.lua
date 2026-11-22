id       = "personal_epub_library"
name     = "Personal EPUB Library"
version  = "1.0.0"
baseUrl  = "__BASE_URL__"
language = "id"

local _libs
local function LIB(id)
  if type(require_lib) ~= "function" then
    show_error("Requires NoveLA update", "This plugin needs the shared libraries")
    error("Requires NoveLA update (require_lib)", 0)
  end
  if not _libs then _libs = {} end
  if not _libs[id] then _libs[id] = require_lib(id) end
  return _libs[id]
end

local function fetchPage(url) return LIB("fetch").page(url) end
local function absUrl(href)
  if not href or href == "" then return "" end
  return LIB("urls").absUrl(baseUrl, href)
end
local url_encode = function(s) return LIB("catalog").urlEncode(s) end

-- Halaman daftar dari server: .librarylist li > .novelname, a, img, .info span (span ke-2 = "Author: ..."), .intro
local function parseItems(html)
  local items = {}
  for _, row in ipairs(html_select(html, ".librarylist li")) do
    local nameEl = html_select_first(row.html, ".novelname")
    local linkEl = html_select_first(row.html, "a")
    if nameEl and linkEl then
      local cover = absUrl(html_attr(row.html, "img", "src"))
      local spans = html_select(row.html, ".info span")
      local author = ""
      if spans[2] then
        author = string_clean(spans[2].text)
        author = author:gsub("^Author:%s*", "")
      end
      local introEl = html_select_first(row.html, ".intro")
      local intro = introEl and string_trim(introEl.text) or ""
      table.insert(items, {
        title  = string_clean(nameEl.text),
        url    = absUrl(linkEl.href),
        cover  = cover,
        author = author,
        intro  = intro
      })
    end
  end
  return items
end

local function listPage(url)
  local r = http_get(url)
  if not r.success then return { items = {}, hasNext = false } end
  local items = parseItems(r.body)
  return { items = items, hasNext = LIB("catalog").hasNextPage(items) }
end

function getFilterList()
  return {
    { type = "select", key = "category", label = "Kategori", defaultValue = "/category/all/",
      options = { { value = "/category/all/", label = "Semua" } } }
  }
end

local function catalogUrl(index)
  local page = LIB("catalog").nextIndex(index)
  local url = baseUrl .. "/category/all/"
  if page > 1 then url = url .. tostring(page) .. ".html" end
  return url
end

function getCatalogList(index) return listPage(catalogUrl(index)) end
function getCatalogFiltered(index, filters) return listPage(catalogUrl(index)) end

function getCatalogSearch(index, query)
  local page = LIB("catalog").nextIndex(index)
  local url = baseUrl .. "/s/search?searchkey=" .. url_encode(query)
  if page > 1 then url = url .. "&page=" .. tostring(page) end
  return listPage(url)
end

local function meta(bookUrl, prop)
  local body = fetchPage(bookUrl)
  if not body then return nil end
  local val = html_attr(body, "meta[property='" .. prop .. "']", "content")
  return (val and val ~= "") and val or nil
end

function getBookTitle(bookUrl)
  local v = meta(bookUrl, "og:novel:book_name")
  return v and string_clean(v) or nil
end
function getBookAuthor(bookUrl)
  local v = meta(bookUrl, "og:novel:author")
  return v and string_clean(v) or nil
end
function getBookCoverImageUrl(bookUrl)
  local v = meta(bookUrl, "og:image")
  return v and absUrl(v) or nil
end
function getBookDescription(bookUrl)
  local v = meta(bookUrl, "og:description")
  return v and string_trim(v) or nil
end
function getBookGenres(bookUrl)
  local v = meta(bookUrl, "og:novel:category")
  if v then return { string_clean(v) } end
  return {}
end
function getBookStatus(bookUrl) return nil end

function parsePage(bookUrl, page)
  local body = fetchPage(bookUrl)
  if not body then return { chapters = {}, totalPages = 1 } end
  local chapters = {}
  for _, a in ipairs(html_select(body, ".hide a")) do
    local chUrl = absUrl(a.href)
    if chUrl ~= "" then
      table.insert(chapters, { title = string_clean(a.text), url = chUrl })
    end
  end
  return { chapters = chapters, totalPages = 1 }
end

function getChapterText(html, url)
  local cleaned = html_remove(html, "script", "style")
  local el = html_select_first(cleaned, "#chaptercontent")
  if not el then return "" end
  local text = html_text(el.html)
  local ok, res = pcall(function()
    return LIB("content").standardTransforms(text, { domain = baseUrl, lang = language })
  end)
  if ok and type(res) == "string" then return res end
  return text
end
