import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  type HtmlElement,
  NotFoundError,
  ParseError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { DEFAULT_BASE_URL, base, fetchPage, sharedFetch } from './site';
import { readServers, resolveServers } from './streams';
import { STATUSES, TYPES, collapse, entityPath, episodeName, parseEpisodeDate, parseNumber, releaseYear } from './text';
import { labelPlaylists } from './hls-quality';

// animekhor.org: WordPress with the AnimeStream theme, donghua with English and Indonesian subtitles. Everything is
// read from HTML. Entity urls are paths: "/anime/<slug>/" for a series, "/<slug>-episode-<n>-subtitles-english-indonesian/"
// for an episode. The series list lives at "/anime/" (filters and order), the text search at "/?s=".

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The site's genre checkboxes (`/anime/` filter form), without the near-duplicate tags: the SDK takes at most 200 options. */
const GENRES: [slug: string, label: string][] = [
  ['absurdity', 'Absurdity'],
  ['abuse-of-power', 'Abuse of Power'],
  ['action', 'Action'],
  ['adult', 'Adult'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['alchemy', 'Alchemy'],
  ['alternate-reality', 'Alternate Reality'],
  ['ancient-china', 'Ancient China'],
  ['arrogant-male-lead', 'Arrogant Male Lead'],
  ['arrogant-protagonist', 'Arrogant Protagonist'],
  ['artificial-intelligence', 'Artificial Intelligence'],
  ['assassin', 'Assassin'],
  ['athletics', 'Athletics'],
  ['attempted-extortion', 'Attempted Extortion'],
  ['attempted-murder', 'Attempted Murder'],
  ['badass-female-lead', 'Badass Female Lead'],
  ['betrayal', 'Betrayal'],
  ['black-haired-protagonist', 'Black-Haired Protagonist'],
  ['blindness', 'Blindness'],
  ['blood-contract', 'Blood Contract'],
  ['bullied-male-lead', 'Bullied Male Lead'],
  ['bullied-protagonist', 'Bullied Protagonist'],
  ['bullying', 'Bullying'],
  ['business', 'Business'],
  ['business-management', 'Business Management'],
  ['businessman-businesswoman', 'Businessman / Businesswoman'],
  ['capable-male-lead', 'Capable Male Lead'],
  ['capable-protagonist', 'Capable Protagonist'],
  ['careful-protagonist', 'Careful Protagonist'],
  ['cartoon', 'Cartoon'],
  ['cheat-skills', 'Cheat Skills'],
  ['cheat-systems', 'Cheat Systems'],
  ['childhood-friends', 'Childhood Friends'],
  ['china-cultivation-gangs', 'China Cultivation Gangs'],
  ['clever-male-lead', 'Clever Male Lead'],
  ['clever-protagonist', 'Clever Protagonist'],
  ['combat', 'Combat'],
  ['comedic-facial-expressions', 'Comedic Facial Expressions'],
  ['comedic-misunderstandings', 'Comedic Misunderstandings'],
  ['comedic-violence', 'Comedic Violence'],
  ['comedy', 'Comedy'],
  ['comic', 'Comic'],
  ['competitive', 'Competitive'],
  ['concubines', 'Concubines'],
  ['confident-male-lead', 'Confident Male Lead'],
  ['confident-protagonist', 'Confident Protagonist'],
  ['consorts', 'Consorts'],
  ['corrupt-organization', 'Corrupt Organization'],
  ['corruption', 'Corruption'],
  ['creepy-male-lead', 'Creepy Male Lead'],
  ['cultivation', 'Cultivation'],
  ['curses', 'Curses'],
  ['deception', 'Deception'],
  ['demon', 'Demon'],
  ['demon-lord', 'Demon Lord'],
  ['demons', 'Demons'],
  ['detective', 'Detective'],
  ['discrimination', 'Discrimination'],
  ['dogs', 'Dogs'],
  ['drama', 'Drama'],
  ['dystopia', 'Dystopia'],
  ['ecchi', 'Ecchi'],
  ['empresses', 'Empresses'],
  ['end-of-the-world', 'End of the World'],
  ['family-feud', 'Family Feud'],
  ['fantasy', 'Fantasy'],
  ['fat-male-lead', 'Fat Male Lead'],
  ['fat-protagonist', 'Fat Protagonist'],
  ['framed', 'Framed'],
  ['funny', 'Funny'],
  ['future', 'Future'],
  ['game', 'Game'],
  ['game-elements', 'Game Elements'],
  ['game-industry', 'Game Industry'],
  ['gender-bender', 'Gender Bender'],
  ['ghosts', 'Ghosts'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['harem-seeking-male-lead', 'Harem-Seeking Male Lead'],
  ['high-stakes-game', 'High Stakes Game'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['hospital', 'Hospital'],
  ['hot-blood', 'Hot-Blood'],
  ['human-auction', 'Human Auction'],
  ['human-becomes-monster', 'Human Becomes Monster'],
  ['human-trafficking', 'Human Trafficking'],
  ['hunters', 'Hunters'],
  [
    'im-already-invincible-as-the-assistant-of-the-holy-lord',
    "I'm already invincible as the assistant of the Holy Lord",
  ],
  [
    'im-already-invincible-dynamic-animation-of-the-assistant-of-shengzun',
    "I'm already invincible dynamic animation of the assistant of Shengzun",
  ],
  ['immortality', 'Immortality'],
  ['invincible', 'Invincible'],
  ['isekai', 'Isekai'],
  ['josei', 'Josei'],
  ['lawlessness', 'Lawlessness'],
  ['love-romance', 'Love & Romance'],
  ['magic', 'Magic'],
  ['male-protagonist', 'Male Protagonist'],
  ['manager', 'Manager'],
  ['manhua', 'Manhua'],
  ['martial-arts', 'Martial Arts'],
  ['mature', 'Mature'],
  ['mecha', 'Mecha'],
  ['medical', 'Medical'],
  ['medicines', 'Medicines'],
  ['military', 'Military'],
  ['modern-era', 'Modern Era'],
  ['money', 'Money'],
  ['monster-tamer', 'Monster Tamer'],
  ['monsters', 'Monsters'],
  ['multiple-love-interests', 'Multiple Love Interests'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['old-to-young', 'Old to Young'],
  ['older-sister', 'Older Sister'],
  ['overpowered-male-lead', 'Overpowered Male Lead'],
  ['overpowered-protagonist', 'Overpowered Protagonist'],
  ['past-plays-a-big-role', 'Past Plays a Big Role'],
  ['pill-refinement', 'Pill Refinement'],
  ['poisons', 'Poisons'],
  ['possession', 'Possession'],
  ['post-apocalyptic', 'Post-Apocalyptic'],
  ['pretending-male-lead', 'Pretending Male Lead'],
  ['protagonist', 'Protagonist'],
  ['psychological', 'Psychological'],
  ['queens', 'Queens'],
  ['regression', 'Regression'],
  ['reincarnated-as-an-animal', 'Reincarnated as an Animal'],
  ['reincarnated-in-the-future', 'Reincarnated in the Future'],
  ['reincarnated-lover', 'Reincarnated Lover'],
  ['reincarnation', 'Reincarnation'],
  ['revenge', 'Revenge'],
  ['reverse-harem', 'Reverse Harem'],
  ['rivalry', 'Rivalry'],
  ['romance', 'Romance'],
  ['rpg', 'RPG'],
  ['school', 'School'],
  ['school-life', 'School Life'],
  ['sci-fi', 'Sci-Fi'],
  ['sects', 'Sects'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shoujo-ai', 'Shoujo Ai'],
  ['shounen', 'Shounen'],
  ['shounen-ai', 'Shounen Ai'],
  ['slice-of-life', 'Slice of Life'],
  ['smart-male-lead', 'Smart Male Lead'],
  ['smart-protagonist', 'Smart Protagonist'],
  ['special-abilities', 'Special Abilities'],
  ['special-eyes', 'Special Eyes'],
  ['spirit-beasts', 'Spirit Beasts'],
  ['spirits', 'Spirits'],
  ['spiritual-power', 'Spiritual Power'],
  ['sports', 'Sports'],
  ['strategy-game', 'Strategy Game'],
  ['strong-male-lead', 'Strong Male Lead'],
  ['strong-protagonist', 'Strong Protagonist'],
  ['strong-to-overpowered', 'Strong to Overpowered'],
  ['sudden-strength-gain', 'Sudden Strength Gain'],
  ['super-power', 'Super Power'],
  ['superhero', 'Superhero'],
  ['supernatural', 'Supernatural'],
  ['surgeons', 'Surgeons'],
  ['surgery', 'Surgery'],
  ['survival', 'Survival'],
  ['survival-of-the-fittest', 'Survival of the Fittest'],
  ['suspense', 'Suspense'],
  ['swordplay', 'Swordplay'],
  ['swords-fight', 'Swords Fight'],
  ['system', 'System'],
  ['system-administrator', 'System Administrator'],
  ['thriller', 'Thriller'],
  ['time-rewind', 'Time Rewind'],
  ['time-travel', 'Time Travel'],
  ['tragedy', 'Tragedy'],
  ['transmigration', 'Transmigration'],
  ['transported-to-the-past', 'Transported to the Past'],
  ['travelling-between-worlds', 'Travelling Between Worlds'],
  ['underestimated-protagonist', 'Underestimated Protagonist'],
  ['urban-fantasy', 'Urban Fantasy'],
  ['vengeance', 'Vengeance'],
  ['video-game', 'Video Game'],
  ['villain', 'Villain'],
  ['war', 'War'],
  ['weak-to-strong', 'Weak to Strong'],
  ['webtoon', 'Webtoon'],
  ['wuxia', 'Wuxia'],
  ['xianxia', 'Xianxia'],
  ['xuanhuan', 'Xuanhuan'],
  ['younger-brother', 'Younger Brother'],
  ['younger-sister', 'Younger Sister'],
  ['youth', 'Youth'],
  ['zombie', 'Zombie'],
  ['zombie-apocalypse', 'Zombie Apocalypse'],
];

const STATUS_OPTIONS = [
  ['', 'All'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['upcoming', 'Upcoming'],
  ['hiatus', 'Hiatus'],
] as const;

const TYPE_OPTIONS = [
  ['', 'All'],
  ['tv', 'TV Series'],
  ['ova', 'OVA'],
  ['movie', 'Movie'],
  ['live action', 'Live Action'],
  ['special', 'Special'],
  ['bd', 'BD'],
  ['ona', 'ONA'],
  ['music', 'Music'],
  ['comic', 'Comic'],
] as const;

const ORDER_OPTIONS = [
  ['update', 'Latest Update'],
  ['popular', 'Popular'],
  ['rating', 'Rating'],
  ['latest', 'Latest Added'],
  ['title', 'A-Z'],
  ['titlereverse', 'Z-A'],
] as const;

const SUB_OPTIONS = [
  ['', 'All'],
  ['sub', 'Sub'],
  ['dub', 'Dub'],
  ['raw', 'RAW'],
] as const;

const pick = (filters: FilterState, id: string, allowed: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';
};

/** Reads the cards of a listing. A page that is past the end answers 200 with no cards, or 404. */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('.listupd article.bs')) {
    const link = card.selectFirst('a[itemprop=url]') ?? card.selectFirst('a');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('.tt h2')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const img = card.selectFirst('img');
    const cover = img?.absUrl('src');
    items.push({ url, title, ...(cover && !cover.startsWith('data:') && { thumbnailUrl: cover }) });
  }
  return items;
}

async function listing(path: string, page: number): Promise<AnimePage> {
  const url = `${base()}${path}`;
  let text: string;
  try {
    text = (await fetchPage(url)).text;
  } catch (error) {
    if (page > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const doc = html.load(text, { baseUrl: url });
  const items = readCards(doc, url);
  if (items.length === 0 && !doc.selectFirst('#sidebar, .listupd, .releases')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  // The series list has a "Next" link in `.hpage`; the search results are paginated with `a.next.page-numbers`.
  const hasNextPage = doc.selectFirst('.hpage a.r') !== null || doc.selectFirst('a.next.page-numbers') !== null;
  return { items, hasNextPage };
}

function browse(params: Record<string, string>, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  if (page > 1) query.set('page', String(Math.floor(page)));
  const qs = query.toString();
  return listing(`/anime/${qs ? `?${qs}` : ''}`, page);
}

async function seriesPage(anime: AnimeSummary): Promise<HtmlElement> {
  const url = `${base()}${anime.url}`;
  // The app asks for the details and the episodes of an anime together; both read this page.
  const doc = html.load((await sharedFetch(url, fetchPage)).text, { baseUrl: url });
  if (!doc.selectFirst('h1.entry-title')) throw new ParseError('The series page has no title: the site layout changed');
  return doc;
}

/** `<span><b>Label:</b> value</span>` rows of the info block. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const lines = doc.select('.info-content .spe span').map((span) => collapse(span.text()));
  return (label) => {
    const prefix = `${label.toLowerCase()}:`;
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
    const value = line?.slice(prefix.length).trim();
    return value && !/^(?:\?|-|unknown)$/i.test(value) ? value : undefined;
  };
}

/** The synopsis is written twice ("English", then "Indonesia"); both are kept, without the language captions. */
function readSynopsis(doc: HtmlElement): string {
  const paragraphs = doc
    .select('.synp .entry-content p')
    .map((p) => collapse(p.text()))
    .map((text) => text.replace(/^(?:English|Indonesia|Indonesian)\s*(?=\S)/i, ''))
    .filter((text) => text && !/^(?:English|Indonesia|Indonesian)$/i.test(text))
    // The closing line only lists the subtitle languages ("... Subtitle Indonesia, English, Portuguese, ...").
    .filter((text) => !/\bSubtitle\s+Indonesia,\s*English,/i.test(text));
  return paragraphs.join('\n\n');
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'Use another address if the site moves. Libraries store paths, so they survive.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => browse({ order: 'popular' }, page),

    /** Series ordered by their newest episode. */
    getLatest: (page) => browse({ order: 'update' }, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own search ignores the filters.
        const path = page > 1 ? `/page/${Math.floor(page)}/` : '/';
        return listing(`${path}?${new URLSearchParams({ s: text }).toString()}`, page);
      }
      const genre = filters['genre'];
      const params: Record<string, string> = {
        status: pick(filters, 'status', STATUS_OPTIONS),
        type: pick(filters, 'type', TYPE_OPTIONS),
        sub: pick(filters, 'sub', SUB_OPTIONS),
        order: pick(filters, 'order', ORDER_OPTIONS) || 'update',
      };
      const query2 = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) if (value) query2.append(key, value);
      if (typeof genre === 'string' && GENRES.some(([slug]) => slug === genre)) query2.append('genre[]', genre);
      if (page > 1) query2.set('page', String(Math.floor(page)));
      return listing(`/anime/?${query2.toString()}`, page);
    },

    getFilters: (): Filter[] => [
      { type: 'header', label: 'These filters apply only when the search box is empty.' },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'status',
        label: 'Status',
        options: STATUS_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'type',
        label: 'Type',
        options: TYPE_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'sub',
        label: 'Language',
        options: SUB_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'order',
        label: 'Order by',
        options: ORDER_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'update',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await seriesPage(anime);
      const info = readInfo(doc);
      const title = collapse(doc.selectFirst('h1.entry-title')?.text() ?? '');
      if (!title) throw new ParseError('The series page has no title');

      const alt = (doc.selectFirst('.alter')?.text() ?? '')
        .split(',')
        .map(collapse)
        .filter((name) => name && name.toLowerCase() !== title.toLowerCase());
      const genres = doc
        .select('.genxed a')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const cover = doc.selectFirst('.thumbook .thumb img')?.absUrl('src');
      const synopsis = readSynopsis(doc);
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover && !cover.startsWith('data:') ? cover : undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio') ?? info('Network'),
        year: releaseYear(info('Released')),
        status: STATUSES[(info('Status') ?? '').toLowerCase()] ?? 'unknown',
        type: TYPES[(info('Type') ?? '').toLowerCase()],
      };
    },

    /** The page lists newest first already; numbered episodes are sorted by number anyway. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await seriesPage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const row of doc.select('.eplister ul li')) {
        const link = row.selectFirst('a');
        const href = link?.attr('href');
        if (!link || !href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const label = collapse(row.selectFirst('.epl-num')?.text() ?? '');
        const number = parseNumber(label);
        const title = collapse(row.selectFirst('.epl-title')?.text() ?? '');
        episodes.push({
          url,
          name: episodeName(title || label, label),
          ...(number !== undefined && { number }),
          uploadedAt: parseEpisodeDate(row.selectFirst('.epl-date')?.text() ?? ''),
        });
      }
      // A film or a single special is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    async getStreams(episode: Episode) {
      const url = `${base()}${episode.url}`;
      const doc = html.load((await fetchPage(url)).text, { baseUrl: url });
      return labelPlaylists(await resolveServers(readServers(doc)));
    },

    resolveUrl(url: string): AnimeSummary | null {
      const slug = /^https?:\/\/(?:www\.)?animekhor\.[a-z]+\/anime\/([^/?#]+)\/?$/i.exec(url)?.[1];
      // "/anime/" alone is the series list; a series page is "/anime/<slug>/".
      if (!slug) return null;
      return { url: `/anime/${slug}/`, title: slug.replace(/-/g, ' ') };
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
