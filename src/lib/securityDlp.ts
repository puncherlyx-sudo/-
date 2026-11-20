/**
 * Некастодиальный DLP-фильтр, Web Crypto AES-GCM шифрование локальных секретов,
 * хэширование PIN-кода и безопасный парсинг числового ввода.
 */

export const DLP_WARNING_MESSAGE =
  'Внимание! Никогда не вводите Seed-фразы и приватные ключи. VERNIER — некастодиальный аналитический терминал.';

const HEX_64_REGEX = /\b(?:0x)?[0-9a-fA-F]{64}\b/;
const WIF_KEY_REGEX = /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/;
const XPRV_REGEX = /\b(?:xprv|yprv|zprv|tprv)[1-9A-HJ-NP-Za-km-z]{80,120}\b/;

// Частые BIP-39 слова для повышения точности детекции мнемонических фраз из 12 или 24 слов
const BIP39_COMMON_ANCHORS = new Set([
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
  'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
  'action', 'actor', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult',
  'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent', 'agree',
  'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert', 'alien',
  'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter', 'always',
  'amateur', 'amazing', 'among', 'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle',
  'angry', 'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique', 'anxiety',
  'apple', 'april', 'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact', 'artist', 'artwork',
  'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball', 'bamboo', 'banana', 'banner', 'bar',
  'barely', 'bargain', 'barrel', 'base', 'basic', 'basket', 'battle', 'beach', 'bean', 'beauty',
  'because', 'become', 'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt',
  'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle', 'bid', 'bike',
  'black', 'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood', 'blossom',
  'blue', 'board', 'boat', 'body', 'bonus', 'book', 'boost', 'border', 'boss', 'bottom',
  'box', 'boy', 'brain', 'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge',
  'bright', 'bring', 'broken', 'bronze', 'brother', 'brown', 'brush', 'bubble', 'buddy', 'budget',
  'cabin', 'cable', 'cactus', 'cage', 'cake', 'call', 'calm', 'camera', 'camp', 'canal',
  'cancel', 'candy', 'cannon', 'canvas', 'canyon', 'capable', 'capital', 'captain', 'car', 'carbon',
  'card', 'cargo', 'carpet', 'carry', 'cart', 'case', 'cash', 'casino', 'castle', 'casual',
  'cat', 'catalog', 'catch', 'category', 'cattle', 'caught', 'cause', 'caution', 'cave', 'ceiling',
  'chair', 'chalk', 'champion', 'change', 'chaos', 'chapter', 'charge', 'chase', 'cheap', 'check',
  'cheese', 'chef', 'cherry', 'chest', 'chicken', 'chief', 'child', 'chimney', 'choice', 'choose',
  'circle', 'citizen', 'city', 'civil', 'claim', 'clap', 'clarify', 'claw', 'clay', 'clean',
  'clerk', 'clever', 'click', 'client', 'cliff', 'climb', 'clinic', 'clip', 'clock', 'close',
  'cloud', 'clown', 'club', 'clump', 'cluster', 'clutch', 'coach', 'coast', 'coconut', 'code',
  'coffee', 'coil', 'coin', 'collect', 'color', 'column', 'combine', 'come', 'comfort', 'comic',
  'common', 'company', 'concert', 'conduct', 'confirm', 'congress', 'connect', 'consider', 'control', 'convince',
  'cook', 'cool', 'copper', 'copy', 'coral', 'core', 'corn', 'correct', 'cost', 'cotton',
  'couch', 'country', 'couple', 'course', 'cousin', 'cover', 'coyote', 'crack', 'cradle', 'craft',
  'crane', 'crash', 'crater', 'crawl', 'crazy', 'cream', 'credit', 'creek', 'crew', 'cricket',
  'crime', 'crisp', 'critic', 'crop', 'cross', 'crouch', 'crowd', 'crucial', 'cruel', 'cruise',
  'crumble', 'crunch', 'crush', 'cry', 'crystal', 'cube', 'culture', 'cup', 'cupboard', 'curious',
  'current', 'curtain', 'curve', 'cushion', 'custom', 'cute', 'cycle', 'dad', 'damage', 'damp',
  'dance', 'danger', 'daring', 'dash', 'daughter', 'dawn', 'day', 'deal', 'debate', 'debris',
  'decade', 'december', 'decide', 'decline', 'decorate', 'decrease', 'deer', 'defense', 'define', 'defy',
  'degree', 'delay', 'deliver', 'demand', 'demise', 'denial', 'dentist', 'deny', 'depart', 'depend',
  'deposit', 'depth', 'deputy', 'derive', 'describe', 'desert', 'design', 'desk', 'despair', 'destroy',
  'detail', 'detect', 'develop', 'device', 'devote', 'diagram', 'dial', 'diamond', 'diary', 'dice',
  'diesel', 'diet', 'differ', 'digital', 'dignity', 'dilemma', 'dinner', 'dinosaur', 'direct', 'dirt',
  'earth', 'easily', 'east', 'easy', 'echo', 'ecology', 'economy', 'edge', 'edit', 'educate',
  'effort', 'egg', 'eight', 'either', 'elbow', 'elder', 'electric', 'elegant', 'element', 'elephant',
  'energy', 'enforce', 'engage', 'engine', 'enhance', 'enjoy', 'enlist', 'enough', 'enrich', 'enroll',
  'ensure', 'enter', 'entire', 'entry', 'envelope', 'episode', 'equal', 'equip', 'era', 'erase',
  'fabric', 'face', 'faculty', 'fade', 'faint', 'faith', 'fall', 'false', 'fame', 'family',
  'famous', 'fan', 'fancy', 'fantasy', 'farm', 'fashion', 'fat', 'fatal', 'father', 'fatigue',
  'fault', 'favorite', 'feature', 'february', 'federal', 'fee', 'feed', 'feel', 'female', 'fence',
  'festival', 'fetch', 'fever', 'few', 'fiber', 'fiction', 'field', 'figure', 'file', 'film',
  'filter', 'final', 'find', 'fine', 'finger', 'finish', 'fire', 'firm', 'first', 'fiscal',
  'fish', 'fit', 'fitness', 'fix', 'flag', 'flame', 'flash', 'flat', 'flavor', 'flee',
  'flight', 'flip', 'float', 'flock', 'floor', 'flower', 'fluid', 'flush', 'fly', 'foam',
  'focus', 'fog', 'foil', 'fold', 'follow', 'food', 'foot', 'force', 'forest', 'forget',
  'fork', 'fortune', 'forum', 'forward', 'fossil', 'foster', 'found', 'fox', 'fragile', 'frame',
  'galaxy', 'gallery', 'game', 'gap', 'garage', 'garbage', 'garden', 'garlic', 'garment', 'gas',
  'gasp', 'gate', 'gather', 'gauge', 'gaze', 'general', 'genius', 'genre', 'gentle', 'genuine',
  'gesture', 'ghost', 'giant', 'gift', 'giggle', 'ginger', 'giraffe', 'girl', 'give', 'glad',
  'glance', 'glare', 'glass', 'glide', 'glimpse', 'globe', 'gloom', 'glory', 'glove', 'glow',
  'glue', 'goat', 'goddess', 'gold', 'good', 'goose', 'gorilla', 'gospel', 'gossip', 'govern',
  'gown', 'grab', 'grace', 'grain', 'grant', 'grape', 'grass', 'gravity', 'great', 'green',
  'grid', 'grief', 'grit', 'grocery', 'group', 'grow', 'grunt', 'guard', 'guess', 'guide',
  'hammer', 'hamster', 'hand', 'happy', 'harbor', 'hard', 'harsh', 'harvest', 'hat', 'have',
  'hawk', 'hazard', 'head', 'health', 'heart', 'heavy', 'hedgehog', 'height', 'hello', 'helmet',
  'help', 'hen', 'hero', 'hidden', 'high', 'hill', 'hint', 'hip', 'hire', 'history',
  'hobby', 'hockey', 'hold', 'hole', 'holiday', 'hollow', 'home', 'honey', 'hood', 'hope',
  'horn', 'horror', 'horse', 'hospital', 'host', 'hotel', 'hour', 'hover', 'hub', 'huge',
  'human', 'humble', 'humor', 'hundred', 'hungry', 'hunt', 'hurdle', 'hurry', 'hurt', 'husband',
  'hybrid', 'ice', 'icon', 'idea', 'identify', 'idle', 'ignore', 'ill', 'illegal', 'illness',
  'image', 'imitate', 'immense', 'immune', 'impact', 'impose', 'improve', 'impulse', 'inch', 'include',
  'income', 'increase', 'index', 'indicate', 'indoor', 'industry', 'infant', 'inflict', 'inform', 'inhale',
  'jacket', 'jaguar', 'jar', 'jazz', 'jealous', 'jeans', 'jelly', 'jewel', 'job', 'join',
  'joke', 'journey', 'joy', 'judge', 'juice', 'jump', 'jungle', 'junior', 'junk', 'just',
  'kangaroo', 'keen', 'keep', 'ketchup', 'key', 'kick', 'kid', 'kidney', 'kind', 'kingdom',
  'kiss', 'kit', 'kitchen', 'kite', 'kitten', 'kiwi', 'knee', 'knife', 'knock', 'know',
  'label', 'labor', 'ladder', 'lady', 'lake', 'lamp', 'language', 'laptop', 'large', 'later',
  'latin', 'laugh', 'laundry', 'lava', 'law', 'lawn', 'lawsuit', 'layer', 'lazy', 'leader',
  'leaf', 'learn', 'leave', 'lecture', 'left', 'leg', 'legal', 'legend', 'leisure', 'lemon',
  'letter', 'level', 'liar', 'liberty', 'library', 'license', 'life', 'lift', 'light', 'like',
  'limb', 'limit', 'link', 'lion', 'liquid', 'list', 'little', 'live', 'lizard', 'load',
  'loan', 'lobster', 'local', 'lock', 'logic', 'lonely', 'long', 'loop', 'lottery', 'loud',
  'lounge', 'love', 'loyal', 'lucky', 'luggage', 'lumber', 'lunar', 'lunch', 'luxury', 'lyrics',
  'machine', 'mad', 'magic', 'magnet', 'maid', 'mail', 'main', 'major', 'make', 'mammal',
  'man', 'manage', 'mandate', 'mango', 'mansion', 'manual', 'maple', 'marble', 'march', 'margin',
  'marine', 'market', 'marriage', 'mask', 'mass', 'master', 'match', 'material', 'math', 'matrix',
  'matter', 'maximum', 'maze', 'meadow', 'mean', 'measure', 'meat', 'mechanic', 'medal', 'media',
  'melody', 'melt', 'member', 'memory', 'mention', 'menu', 'mercy', 'merge', 'merit', 'merry',
  'mesh', 'message', 'metal', 'method', 'middle', 'midnight', 'milk', 'million', 'mimic', 'mind',
  'minimum', 'minor', 'minute', 'miracle', 'mirror', 'misery', 'miss', 'mistake', 'mix', 'mixed',
  'mixture', 'mobile', 'model', 'modify', 'mom', 'moment', 'monitor', 'monkey', 'monster', 'month',
  'moon', 'moral', 'more', 'morning', 'mosquito', 'mother', 'motion', 'motor', 'mountain', 'mouse',
  'move', 'movie', 'much', 'muffin', 'mule', 'multiply', 'muscle', 'museum', 'mushroom', 'music',
  'must', 'mutual', 'myself', 'mystery', 'myth', 'naive', 'name', 'napkin', 'narrow', 'nasty',
  'nation', 'nature', 'near', 'neck', 'need', 'negative', 'neglect', 'neither', 'nephew', 'nerve',
  'nest', 'net', 'network', 'neutral', 'never', 'news', 'next', 'nice', 'night', 'noble',
  'noise', 'nominee', 'noodle', 'normal', 'north', 'nose', 'notable', 'note', 'nothing', 'notice',
  'novel', 'now', 'nuclear', 'number', 'nurse', 'nut', 'oak', 'obey', 'object', 'oblige',
  'obscure', 'observe', 'obtain', 'obvious', 'occur', 'ocean', 'october', 'odor', 'off', 'offer',
  'office', 'often', 'oil', 'okay', 'old', 'olive', 'olympic', 'omit', 'once', 'one',
  'onion', 'online', 'only', 'open', 'opera', 'opinion', 'oppose', 'option', 'orange', 'orbit',
  'orchard', 'order', 'ordinary', 'organ', 'orient', 'original', 'orphan', 'ostrich', 'other', 'outdoor',
  'outer', 'output', 'outside', 'oval', 'oven', 'over', 'own', 'owner', 'oxygen', 'oyster',
  'ozone', 'pact', 'paddle', 'page', 'pair', 'palace', 'palm', 'panda', 'panel', 'panic',
  'panther', 'paper', 'parade', 'parent', 'park', 'parrot', 'party', 'pass', 'patch', 'path',
  'patient', 'patrol', 'pattern', 'pause', 'pave', 'payment', 'peace', 'peanut', 'pear', 'peasant',
  'pelican', 'pen', 'penalty', 'pencil', 'people', 'pepper', 'perfect', 'permit', 'person', 'pet',
  'phone', 'photo', 'phrase', 'physical', 'piano', 'picnic', 'picture', 'piece', 'pig', 'pigeon',
  'pill', 'pilot', 'pink', 'pioneer', 'pipe', 'pistol', 'pitch', 'pizza', 'place', 'planet',
  'plastic', 'plate', 'play', 'please', 'pledge', 'pluck', 'plug', 'plunge', 'poem', 'poet',
  'point', 'polar', 'pole', 'police', 'pond', 'pony', 'pool', 'popular', 'portion', 'position',
  'possible', 'post', 'potato', 'pottery', 'poverty', 'powder', 'power', 'practice', 'praise', 'predict',
  'prefer', 'prepare', 'present', 'pretty', 'prevent', 'price', 'pride', 'primary', 'print', 'priority',
  'prison', 'private', 'prize', 'problem', 'process', 'produce', 'profit', 'program', 'project', 'promote',
  'proof', 'property', 'prosper', 'protect', 'proud', 'provide', 'public', 'pudding', 'pull', 'pulp',
  'pulse', 'pumpkin', 'punch', 'pupil', 'puppy', 'purchase', 'purity', 'purpose', 'purse', 'push',
  'put', 'puzzle', 'pyramid', 'quality', 'quantum', 'quarter', 'question', 'quick', 'quit', 'quiz',
  'quote', 'rabbit', 'raccoon', 'race', 'rack', 'radar', 'radio', 'rail', 'rain', 'raise',
  'rally', 'ramp', 'ranch', 'random', 'range', 'rapid', 'rare', 'rate', 'rather', 'raven',
  'raw', 'razor', 'ready', 'real', 'reason', 'rebel', 'rebuild', 'recall', 'receive', 'recipe',
  'record', 'recycle', 'reduce', 'reflect', 'reform', 'refuse', 'region', 'regret', 'regular', 'reject',
  'relax', 'release', 'relief', 'rely', 'remain', 'remember', 'remind', 'remove', 'render', 'renew',
  'rent', 'reopen', 'repair', 'repeat', 'replace', 'report', 'require', 'rescue', 'resemble', 'resist',
  'resource', 'response', 'result', 'retire', 'retreat', 'return', 'reunion', 'reveal', 'review', 'reward',
  'rhythm', 'rib', 'ribbon', 'rice', 'rich', 'ride', 'ridge', 'rifle', 'right', 'rigid',
  'ring', 'riot', 'ripple', 'risk', 'ritual', 'rival', 'river', 'road', 'roast', 'robot',
  'robust', 'rocket', 'romance', 'roof', 'rookie', 'room', 'rose', 'rotate', 'rough', 'round',
  'route', 'royal', 'rubber', 'rude', 'rug', 'rule', 'run', 'runway', 'rural', 'sad',
  'saddle', 'sadness', 'safe', 'sail', 'salad', 'salmon', 'salon', 'salt', 'salute', 'same',
  'sample', 'sand', 'satisfy', 'satoshi', 'sauce', 'sausage', 'save', 'say', 'scale', 'scan',
  'scare', 'scatter', 'scene', 'scheme', 'school', 'science', 'scissors', 'scorpion', 'scout', 'scrap',
  'screen', 'script', 'scrub', 'sea', 'search', 'season', 'seat', 'second', 'secret', 'section',
  'security', 'seed', 'seek', 'segment', 'select', 'sell', 'seminar', 'senior', 'sense', 'sentence',
  'series', 'service', 'session', 'settle', 'setup', 'seven', 'shadow', 'shaft', 'shallow', 'share',
  'shed', 'shell', 'sheriff', 'shield', 'shift', 'shine', 'ship', 'shiver', 'shock', 'shoe',
  'shoot', 'shop', 'short', 'shoulder', 'shove', 'shrimp', 'shrug', 'shuffle', 'shy', 'sibling',
  'sick', 'side', 'siege', 'sight', 'sign', 'silent', 'silk', 'silly', 'silver', 'similar',
  'simple', 'since', 'sing', 'siren', 'sister', 'situate', 'six', 'size', 'skate', 'sketch',
  'ski', 'skill', 'skin', 'skirt', 'skull', 'slab', 'slam', 'sleep', 'slender', 'slice',
  'slide', 'slight', 'slim', 'slogan', 'slot', 'slow', 'slush', 'small', 'smart', 'smile',
  'smoke', 'smooth', 'snack', 'snake', 'snap', 'sniff', 'snow', 'soap', 'soccer', 'social',
  'sock', 'soda', 'soft', 'solar', 'soldier', 'solid', 'solution', 'solve', 'someone', 'song',
  'soon', 'sorry', 'sort', 'soul', 'sound', 'soup', 'source', 'south', 'space', 'spare',
  'spatial', 'spawn', 'speak', 'special', 'speed', 'spell', 'spend', 'sphere', 'spice', 'spider',
  'spike', 'spin', 'spirit', 'split', 'spoil', 'sponsor', 'spoon', 'sport', 'spot', 'spray',
  'spread', 'spring', 'spy', 'square', 'squeeze', 'squirrel', 'stable', 'stadium', 'staff', 'stage',
  'stairs', 'stamp', 'stand', 'start', 'state', 'stay', 'steak', 'steel', 'stem', 'step',
  'stereo', 'stick', 'still', 'sting', 'stock', 'stomach', 'stone', 'stool', 'story', 'stove',
  'strategy', 'street', 'strike', 'strong', 'struggle', 'student', 'stuff', 'stumble', 'style', 'subject',
  'submit', 'subway', 'success', 'such', 'sudden', 'suffer', 'sugar', 'suggest', 'suit', 'summer',
  'sun', 'sunny', 'sunset', 'super', 'supply', 'supreme', 'sure', 'surface', 'surge', 'surprise',
  'surround', 'survey', 'suspect', 'sustain', 'swallow', 'swamp', 'swap', 'swarm', 'swear', 'sweet',
  'swift', 'swim', 'swing', 'switch', 'sword', 'symbol', 'symptom', 'syrup', 'system', 'table',
  'tackle', 'tag', 'tail', 'talent', 'talk', 'tank', 'tape', 'target', 'task', 'taste',
  'tattoo', 'taxi', 'teach', 'team', 'tell', 'ten', 'tenant', 'tennis', 'tent', 'term',
  'test', 'text', 'thank', 'that', 'theme', 'then', 'theory', 'there', 'they', 'thing',
  'this', 'thought', 'three', 'thrive', 'throw', 'thumb', 'thunder', 'ticket', 'tide', 'tiger',
  'tilt', 'timber', 'time', 'tiny', 'tip', 'tired', 'tissue', 'title', 'toast', 'tobacco',
  'today', 'toddler', 'toe', 'together', 'toilet', 'token', 'tomato', 'tomorrow', 'tone', 'tongue',
  'tonight', 'tool', 'tooth', 'top', 'topic', 'topple', 'torch', 'tornado', 'tortoise', 'toss',
  'total', 'tourist', 'toward', 'tower', 'town', 'toy', 'track', 'trade', 'traffic', 'tragic',
  'train', 'transfer', 'trap', 'trash', 'travel', 'tray', 'treat', 'tree', 'trend', 'trial',
  'tribe', 'trick', 'trigger', 'trim', 'trip', 'trophy', 'trouble', 'truck', 'true', 'truly',
  'trumpet', 'trust', 'truth', 'try', 'tube', 'tuition', 'tumble', 'tuna', 'tunnel', 'turkey',
  'turn', 'turtle', 'twelve', 'twenty', 'twice', 'twin', 'twist', 'two', 'type', 'typical',
  'ugly', 'umbrella', 'unable', 'unaware', 'uncle', 'uncover', 'under', 'undo', 'unfair', 'unfold',
  'unhappy', 'uniform', 'unique', 'unit', 'universe', 'unknown', 'unlock', 'until', 'unusual', 'unveil',
  'update', 'upgrade', 'uphold', 'upon', 'upper', 'upset', 'urban', 'urge', 'usage', 'use',
  'used', 'useful', 'useless', 'usual', 'utility', 'vacant', 'vacuum', 'vague', 'valid', 'valley',
  'valve', 'van', 'vanish', 'vapor', 'various', 'vast', 'vault', 'vehicle', 'velvet', 'vendor',
  'venture', 'venue', 'verb', 'verify', 'version', 'very', 'vessel', 'veteran', 'viable', 'vibrant',
  'vicious', 'victory', 'video', 'view', 'village', 'vintage', 'violin', 'virtual', 'virus', 'visa',
  'visit', 'visual', 'vital', 'vivid', 'vocal', 'voice', 'void', 'volcano', 'volume', 'vote',
  'voyage', 'wage', 'wagon', 'wait', 'walk', 'wall', 'walnut', 'want', 'warfare', 'warm',
  'warrior', 'wash', 'wasp', 'waste', 'water', 'wave', 'way', 'wealth', 'weapon', 'wear',
  'weasel', 'weather', 'web', 'wedding', 'weekend', 'weird', 'welcome', 'west', 'wet', 'whale',
  'what', 'wheat', 'wheel', 'when', 'where', 'whip', 'whisper', 'wide', 'width', 'wife',
  'wild', 'will', 'win', 'window', 'wine', 'wing', 'wink', 'winner', 'winter', 'wire',
  'wisdom', 'wise', 'wish', 'witness', 'wolf', 'woman', 'wonder', 'wood', 'wool', 'word',
  'work', 'world', 'worry', 'worth', 'wrap', 'wreck', 'wrestle', 'wrist', 'write', 'wrong',
  'yard', 'year', 'yellow', 'you', 'young', 'youth', 'zebra', 'zero', 'zone', 'zoo',
]);

export interface DlpCheckResult {
  blocked: boolean;
  reason: 'seed_phrase' | 'private_key' | null;
  warning: string | null;
}

/**
 * Проверяет произвольный ввод на наличие 12/24-словной Seed-фразы или приватного ключа.
 */
export function detectSensitiveWalletInput(raw: string): DlpCheckResult {
  if (!raw || raw.trim().length < 24) {
    return { blocked: false, reason: null, warning: null };
  }
  const text = raw.trim();

  if (HEX_64_REGEX.test(text) || WIF_KEY_REGEX.test(text) || XPRV_REGEX.test(text)) {
    return {
      blocked: true,
      reason: 'private_key',
      warning: DLP_WARNING_MESSAGE,
    };
  }

  const tokens = text
    .toLowerCase()
    .replace(/[\r\n\t,;]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 12 || tokens.length === 15 || tokens.length === 18 || tokens.length === 24) {
    const allAsciiWords = tokens.every((w) => /^[a-z]{3,10}$/.test(w));
    if (allAsciiWords) {
      let anchorHits = 0;
      for (const word of tokens) {
        if (BIP39_COMMON_ANCHORS.has(word)) anchorHits += 1;
      }
      // Если хотя бы половина слов — из словаря BIP-39 или ровно 12/24 строгих латинских слов в одном вводе
      if (anchorHits >= Math.ceil(tokens.length * 0.4) || (tokens.length === 12 && anchorHits >= 4) || (tokens.length === 24 && anchorHits >= 7)) {
        return {
          blocked: true,
          reason: 'seed_phrase',
          warning: DLP_WARNING_MESSAGE,
        };
      }
    }
  }

  return { blocked: false, reason: null, warning: null };
}

/**
 * Безопасный парсинг чисел с точкой или запятой. Защита от NaN и отрицательных значений.
 */
export function parseLocalePositiveNumber(input: string, fallback = 0): number {
  const cleaned = input.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Мягкий тактильный отклик на поддерживаемых мобильных устройствах.
 */
export function triggerHaptic(durationMs = 10): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch {
    // Игнорируем ограничения браузера
  }
}

/**
 * Санитизация пользовательских строк (защита от XSS/управляющих символов).
 */
export function sanitizePlainText(value: string, maxLen = 400): string {
  return value
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export const PBKDF2_ITERATIONS = 310_000;
const PIN_LOCKOUT_STORAGE_KEY = 'vernier_pin_lockout_v1';

// Очистка старого небезопасного ключа устройства из localStorage, если он оставался от прежней версии
if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem('vernier_device_aes_salt_v1');
  } catch {
    // ignore
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Устаревший SHA-256 хэш — используется только для прозрачной миграции существующих PIN-кодов на PBKDF2.
 */
export async function hashPinLegacySha256(pin: string): Promise<string> {
  const normalized = `vernier-pin-v1::${pin.trim()}`;
  const data = new TextEncoder().encode(normalized);
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const hashBuf = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
}

/**
 * Криптографическое хэширование PIN-кода через Web Crypto PBKDF2 (SHA-256, 310 000 итераций)
 * со случайной 16-байтной солью, хранимой отдельно от хэша.
 */
export async function derivePinPbkdf2(
  pin: string,
  saltBase64?: string
): Promise<{ hash: string; salt: string }> {
  const saltBytes = saltBase64
    ? base64ToBytes(saltBase64)
    : (() => {
        const buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
        return buf;
      })();
  const salt = saltBase64 || bytesToBase64(saltBytes);

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin.trim()),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes as BufferSource,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    const hash = `pbkdf2_v2:${bytesToBase64(new Uint8Array(derivedBits))}`;
    return { hash, salt };
  }

  // Fallback только если SubtleCrypto недоступен в небезопасном контексте
  const legacy = await hashPinLegacySha256(`${salt}:${pin}`);
  return { hash: `legacy_fallback:${legacy}`, salt };
}

/**
 * Проверка PIN-кода: поддерживает новый PBKDF2 (310 000 итераций + соль) и миграцию со старого SHA-256.
 */
export async function verifyPinWithMigration(
  candidatePin: string,
  storedHash: string,
  storedSalt: string | null
): Promise<{ valid: boolean; migrated?: { hash: string; salt: string } }> {
  if (!storedHash) return { valid: false };

  if (storedHash.startsWith('pbkdf2_v2:') && storedSalt) {
    const { hash } = await derivePinPbkdf2(candidatePin, storedSalt);
    return { valid: constantTimeStringEqual(hash, storedHash) };
  }

  // Обратная совместимость со старым SHA-256 + автоматическая миграция на PBKDF2
  const legacyCandidate = await hashPinLegacySha256(candidatePin);
  if (constantTimeStringEqual(legacyCandidate, storedHash)) {
    const upgraded = await derivePinPbkdf2(candidatePin);
    return { valid: true, migrated: upgraded };
  }
  return { valid: false };
}

/** @deprecated Используйте derivePinPbkdf2 */
export async function hashPinSha256(pin: string): Promise<string> {
  const { hash } = await derivePinPbkdf2(pin);
  return hash;
}

// ---------- Защита от перебора PIN-кода (Brute-Force Lockout) ----------

export interface PinLockoutState {
  failedAttempts: number;
  lockedUntilMs: number;
  remainingSeconds: number;
  canWipeVault: boolean;
}

function readRawPinLockout(): { failedAttempts: number; lockedUntilMs: number } {
  if (typeof window === 'undefined') return { failedAttempts: 0, lockedUntilMs: 0 };
  try {
    const raw = window.localStorage.getItem(PIN_LOCKOUT_STORAGE_KEY);
    if (!raw) return { failedAttempts: 0, lockedUntilMs: 0 };
    const parsed = JSON.parse(raw) as { failedAttempts?: unknown; lockedUntilMs?: unknown };
    return {
      failedAttempts: Math.max(0, Number(parsed.failedAttempts) || 0),
      lockedUntilMs: Math.max(0, Number(parsed.lockedUntilMs) || 0),
    };
  } catch {
    return { failedAttempts: 0, lockedUntilMs: 0 };
  }
}

export function getPinLockoutState(): PinLockoutState {
  const raw = readRawPinLockout();
  const remainingMs = Math.max(0, raw.lockedUntilMs - Date.now());
  return {
    failedAttempts: raw.failedAttempts,
    lockedUntilMs: raw.lockedUntilMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    canWipeVault: raw.failedAttempts >= 10,
  };
}

export function recordPinFailure(): PinLockoutState {
  const prev = readRawPinLockout();
  const nextAttempts = prev.failedAttempts + 1;
  let lockDurationMs = 0;
  if (nextAttempts >= 8) {
    lockDurationMs = 5 * 60 * 1000; // 5 минут после 8 неудач
  } else if (nextAttempts >= 5) {
    lockDurationMs = 30 * 1000; // 30 секунд после 5 неудач
  }
  const lockedUntilMs = lockDurationMs > 0 ? Date.now() + lockDurationMs : 0;
  try {
    window.localStorage.setItem(
      PIN_LOCKOUT_STORAGE_KEY,
      JSON.stringify({ failedAttempts: nextAttempts, lockedUntilMs })
    );
  } catch {
    // ignore
  }
  return getPinLockoutState();
}

export function resetPinFailures(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PIN_LOCKOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------- Локальный AES-GCM сейф на базе PBKDF2 (НИКОГДА не хранит сырой ключ в localStorage) ----------

// Расшифрованные секреты и производная мастер-фраза живут ТОЛЬКО в оперативной памяти текущей сессии
let sessionVaultPassphrase: string | null = null;
const decryptedSecretsMemoryCache = new Map<string, string>();

export function setSessionVaultPassphrase(passphrase: string | null): void {
  sessionVaultPassphrase = passphrase ? passphrase.trim() : null;
}

export function hasSessionVaultPassphrase(): boolean {
  return Boolean(sessionVaultPassphrase && sessionVaultPassphrase.length >= 4);
}

/**
 * Очищает расшифрованные секреты и сессионную ключевую фразу из оперативной памяти.
 * Обязательно вызывается при блокировке PIN/2FA, автоблокировке и выходе из аккаунта.
 */
export function clearDecryptedSecretsFromMemory(): void {
  sessionVaultPassphrase = null;
  decryptedSecretsMemoryCache.clear();
}

export function cacheDecryptedSecretInMemory(id: string, value: string): void {
  decryptedSecretsMemoryCache.set(id, value);
}

export function getDecryptedSecretFromMemory(id: string): string | null {
  return decryptedSecretsMemoryCache.get(id) ?? null;
}

async function deriveVaultAesKeyFromPassphrase(
  passphrase: string,
  saltBytes: Uint8Array
): Promise<CryptoKey> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto SubtleCrypto недоступен в текущей среде.');
  }
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Шифрование локального секрета (Read-Only API-ключ) через Web Crypto AES-256-GCM
 * с производным ключом PBKDF2 (310 000 итераций), случайной 16-байтной солью и свежим 12-байтным IV.
 * Сырой ключ шифрования НИКОГДА не сохраняется в localStorage.
 */
export async function encryptLocalSecret(
  plainText: string,
  explicitPassphrase?: string
): Promise<string> {
  const secretPassphrase = (explicitPassphrase || sessionVaultPassphrase || '').trim();
  if (secretPassphrase.length < 4) {
    throw new Error(
      'Для шифрования локального API-ключа укажите мастер-пароль сейфа или 4-значный PIN-код (минимум 4 символа).'
    );
  }
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto API (HTTPS) обязателен для безопасного шифрования ключей.');
  }

  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(salt);
  window.crypto.getRandomValues(iv);

  const key = await deriveVaultAesKeyFromPassphrase(secretPassphrase, salt);
  const encoded = new TextEncoder().encode(plainText);
  const cipherBuf = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return `pbkdf2-aesgcm:v2:${bytesToBase64(salt)}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipherBuf))}`;
}

/**
 * Расшифровка локального секрета AES-256-GCM с использованием PIN/мастер-фразы.
 */
export async function decryptLocalSecret(
  payload: string,
  explicitPassphrase?: string
): Promise<string | null> {
  try {
    if (!payload.startsWith('pbkdf2-aesgcm:v2:')) {
      return null;
    }
    const secretPassphrase = (explicitPassphrase || sessionVaultPassphrase || '').trim();
    if (secretPassphrase.length < 4) return null;

    const parts = payload.split(':');
    if (parts.length !== 5) return null;
    const salt = base64ToBytes(parts[2]);
    const iv = base64ToBytes(parts[3]);
    const data = base64ToBytes(parts[4]);

    const key = await deriveVaultAesKeyFromPassphrase(secretPassphrase, salt);
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      data as BufferSource
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}
