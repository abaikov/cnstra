/**
 * Утилиты для работы с темой "Гниющая плоть"
 */

// Типы для цветовых схем
export type DecayColor =
    | 'flesh-dark'
    | 'flesh-medium'
    | 'flesh-light'
    | 'flesh-infected'
    | 'blood-dark'
    | 'blood-medium'
    | 'blood-bright'
    | 'pus-yellow'
    | 'pus-green'
    | 'bone-dark'
    | 'bone-medium'
    | 'bone-light'
    | 'bone-white'
    | 'infection-red'
    | 'infection-green'
    | 'infection-purple'
    | 'infection-yellow';

export type DecayTextColor =
    | 'text-primary'
    | 'text-secondary'
    | 'text-muted'
    | 'text-accent'
    | 'text-success'
    | 'text-warning'
    | 'text-error';

export type DecayBgColor =
    | 'bg-primary'
    | 'bg-secondary'
    | 'bg-tertiary'
    | 'bg-panel'
    | 'bg-card';

// Функции для получения CSS переменных
export const getDecayColor = (color: DecayColor): string => `var(--${color})`;
export const getTextColor = (color: DecayTextColor): string =>
    `var(--${color})`;
export const getBgColor = (color: DecayBgColor): string => `var(--${color})`;

// Функции для создания стилей с темой
export const createDecayStyle = (styles: Record<string, string | number>) => {
    return Object.entries(styles).reduce((acc, [key, value]) => {
        if (typeof value === 'string' && value.startsWith('decay-')) {
            const colorKey = value.replace('decay-', '') as DecayColor;
            acc[key] = getDecayColor(colorKey);
        } else if (typeof value === 'string' && value.startsWith('text-')) {
            const colorKey = value as DecayTextColor;
            acc[key] = getTextColor(colorKey);
        } else if (typeof value === 'string' && value.startsWith('bg-')) {
            const colorKey = value as DecayBgColor;
            acc[key] = getBgColor(colorKey);
        } else {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, string | number>);
};

// Константы для пиксельных иконок
export const DECAY_ICONS = {
    skull: '💀',
    zombie: '🧟',
    virus: '🦠',
    biohazard: '☣️',
    syringe: '💉',
    pill: '💊',
    dna: '🧬',
    microbe: '🦠',
    crossBones: '☠️',
    ghost: '👻',
    spider: '🕷️',
    bat: '🦇',
    rat: '🐀',
    snake: '🐍',
    scorpion: '🦂',
    warning: '⚠️',
    radiation: '☢️',
    fire: '🔥',
    explosion: '💥',
    lightning: '⚡',
    blood: '🩸',
    bone: '🦴',
    brain: '🧠',
    heart: '❤️',
    lungs: '🫁',
    eye: '👁️',
    tooth: '🦷',
    claw: '🪝',
    chainsaw: '🪚',
    axe: '🪓',
    knife: '🔪',
    sickle: '⚔️',
    shield: '🛡️',
    potion: '🧪',
    flask: '🧪',
    test_tube: '🧪',
    microscope: '🔬',
    petri_dish: '🧫',
    bandage: '🩹',
    thermometer: '🌡️',
    stethoscope: '🩺',
    pill_bottle: '💊',
    injection: '💉',
    x_ray: '🩻',
    hospital: '🏥',
    ambulance: '🚑',
    coffin: '⚰️',
    grave: '🪦',
    church: '⛪',
    castle: '🏰',
    tower: '🗼',
    bridge: '🌉',
    tunnel: '🕳️',
    cave: '🕳️',
    volcano: '🌋',
    desert: '🏜️',
    swamp: '🏞️',
    forest: '🌲',
    tree_dead: '🌳',
    mushroom: '🍄',
    web: '🕸️',
    cocoon: '🛡️',
    egg: '🥚',
    larva: '🐛',
    worm: '🪱',
    maggot: '🐛',
    fly: '🪰',
    mosquito: '🦟',
    tick: '🕷️',
    leech: '🪱',
    slug: '🐌',
    snail: '🐌',
} as const;

// Функции для анимаций
export const createFlickerAnimation = (duration = '2s') => ({
    animation: `flicker ${duration} infinite`,
});

export const createPulseInfectionAnimation = (duration = '1.5s') => ({
    animation: `pulse-infection ${duration} infinite`,
});

export const createDecayGlowAnimation = (duration = '3s') => ({
    animation: `decay-glow ${duration} infinite`,
});

export const createGlitchAnimation = (duration = '2s') => ({
    animation: `glitch ${duration} infinite`,
});

// Функции для создания теней
export const createDecayShadow = (
    type: 'dark' | 'blood' | 'infection' | 'bone' = 'dark'
) => {
    const shadows = {
        dark: 'var(--shadow-dark)',
        blood: 'var(--shadow-blood)',
        infection: 'var(--shadow-infection)',
        bone: 'var(--shadow-bone)',
    };
    return `0 2px 4px ${shadows[type]}`;
};

export const createGlowEffect = (
    color: DecayColor,
    intensity: 'low' | 'medium' | 'high' = 'medium'
) => {
    const intensities = {
        low: '3px',
        medium: '5px',
        high: '8px',
    };
    return `0 0 ${intensities[intensity]} var(--${color})`;
};

// Функции для создания градиентов гниения
export const createDecayGradient = (
    direction = '90deg',
    colors: DecayColor[]
) => {
    const colorVars = colors.map(color => `var(--${color})`).join(', ');
    return `linear-gradient(${direction}, ${colorVars})`;
};

// Готовые стили для компонентов
export const DECAY_COMPONENT_STYLES = {
    button: {
        background: 'var(--flesh-medium)',
        color: 'var(--text-primary)',
        border: '2px solid var(--border-infected)',
        padding: 'var(--spacing-sm) var(--spacing-md)',
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--font-size-sm)',
        cursor: 'pointer',
        transition: 'all var(--transition-fast)',
        textTransform: 'uppercase' as const,
        letterSpacing: '1px',
    },
    card: {
        background: 'var(--bg-card)',
        border: '1px solid var(--border-accent)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--spacing-md)',
        boxShadow:
            '0 2px 4px var(--shadow-dark), inset 0 1px 0 rgba(163, 157, 150, 0.1)',
        transition: 'all var(--transition-medium)',
    },
    panel: {
        background: 'var(--bg-panel)',
        border: '2px solid var(--border-infected)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-lg)',
        boxShadow:
            'inset 0 0 10px var(--shadow-blood), 0 0 20px var(--shadow-dark)',
    },
    input: {
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        border: '2px solid var(--border-primary)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--spacing-sm)',
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--font-size-sm)',
        transition: 'all var(--transition-fast)',
    },
} as const;

// Функция для применения пиксельного рендеринга
export const applyPixelPerfect = () => ({
    imageRendering: 'pixelated' as const,
    WebkitFontSmoothing: 'none' as const,
    MozOsxFontSmoothing: 'grayscale' as const,
    fontSmooth: 'never' as const,
});

// Функция для создания пиксельной сетки (опционально)
export const createPixelGrid = (size = 1) => ({
    backgroundImage: `
    linear-gradient(rgba(163, 157, 150, 0.1) ${size}px, transparent ${size}px),
    linear-gradient(90deg, rgba(163, 157, 150, 0.1) ${size}px, transparent ${size}px)
  `,
    backgroundSize: `${size * 8}px ${size * 8}px`,
});

export default {
    getDecayColor,
    getTextColor,
    getBgColor,
    createDecayStyle,
    DECAY_ICONS,
    createFlickerAnimation,
    createPulseInfectionAnimation,
    createDecayGlowAnimation,
    createGlitchAnimation,
    createDecayShadow,
    createGlowEffect,
    createDecayGradient,
    DECAY_COMPONENT_STYLES,
    applyPixelPerfect,
    createPixelGrid,
};
