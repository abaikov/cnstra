import {
    DecayColor,
    DecayTextColor,
    DecayBgColor,
    getDecayColor,
    getTextColor,
    getBgColor,
    createDecayStyle,
    DECAY_ICONS,
} from '../ui/theme-utils';

describe('theme-utils', () => {
    describe('Color Functions', () => {
        describe('getDecayColor', () => {
            test('returns correct CSS variable for flesh colors', () => {
                expect(getDecayColor('flesh-dark')).toBe('var(--flesh-dark)');
                expect(getDecayColor('flesh-medium')).toBe('var(--flesh-medium)');
                expect(getDecayColor('flesh-light')).toBe('var(--flesh-light)');
                expect(getDecayColor('flesh-infected')).toBe('var(--flesh-infected)');
            });

            test('returns correct CSS variable for blood colors', () => {
                expect(getDecayColor('blood-dark')).toBe('var(--blood-dark)');
                expect(getDecayColor('blood-medium')).toBe('var(--blood-medium)');
                expect(getDecayColor('blood-bright')).toBe('var(--blood-bright)');
            });

            test('returns correct CSS variable for pus colors', () => {
                expect(getDecayColor('pus-yellow')).toBe('var(--pus-yellow)');
                expect(getDecayColor('pus-green')).toBe('var(--pus-green)');
            });

            test('returns correct CSS variable for bone colors', () => {
                expect(getDecayColor('bone-dark')).toBe('var(--bone-dark)');
                expect(getDecayColor('bone-medium')).toBe('var(--bone-medium)');
                expect(getDecayColor('bone-light')).toBe('var(--bone-light)');
                expect(getDecayColor('bone-white')).toBe('var(--bone-white)');
            });

            test('returns correct CSS variable for infection colors', () => {
                expect(getDecayColor('infection-red')).toBe('var(--infection-red)');
                expect(getDecayColor('infection-green')).toBe('var(--infection-green)');
                expect(getDecayColor('infection-purple')).toBe('var(--infection-purple)');
                expect(getDecayColor('infection-yellow')).toBe('var(--infection-yellow)');
            });
        });

        describe('getTextColor', () => {
            test('returns correct CSS variable for text colors', () => {
                expect(getTextColor('text-primary')).toBe('var(--text-primary)');
                expect(getTextColor('text-secondary')).toBe('var(--text-secondary)');
                expect(getTextColor('text-muted')).toBe('var(--text-muted)');
                expect(getTextColor('text-accent')).toBe('var(--text-accent)');
                expect(getTextColor('text-success')).toBe('var(--text-success)');
                expect(getTextColor('text-warning')).toBe('var(--text-warning)');
                expect(getTextColor('text-error')).toBe('var(--text-error)');
            });
        });

        describe('getBgColor', () => {
            test('returns correct CSS variable for background colors', () => {
                expect(getBgColor('bg-primary')).toBe('var(--bg-primary)');
                expect(getBgColor('bg-secondary')).toBe('var(--bg-secondary)');
                expect(getBgColor('bg-tertiary')).toBe('var(--bg-tertiary)');
                expect(getBgColor('bg-panel')).toBe('var(--bg-panel)');
                expect(getBgColor('bg-card')).toBe('var(--bg-card)');
            });
        });
    });

    describe('createDecayStyle', () => {
        test('converts decay color prefixes to CSS variables', () => {
            const styles = {
                color: 'decay-flesh-dark',
                backgroundColor: 'decay-blood-bright',
                borderColor: 'decay-infection-red',
            };

            const result = createDecayStyle(styles);

            expect(result).toEqual({
                color: 'var(--flesh-dark)',
                backgroundColor: 'var(--blood-bright)',
                borderColor: 'var(--infection-red)',
            });
        });

        test('converts text color prefixes to CSS variables', () => {
            const styles = {
                color: 'text-primary',
                borderColor: 'text-accent',
                textShadow: 'text-error',
            };

            const result = createDecayStyle(styles);

            expect(result).toEqual({
                color: 'var(--text-primary)',
                borderColor: 'var(--text-accent)',
                textShadow: 'var(--text-error)',
            });
        });

        test('converts background color prefixes to CSS variables', () => {
            const styles = {
                backgroundColor: 'bg-primary',
                background: 'bg-card',
                borderBackground: 'bg-panel',
            };

            const result = createDecayStyle(styles);

            expect(result).toEqual({
                backgroundColor: 'var(--bg-primary)',
                background: 'var(--bg-card)',
                borderBackground: 'var(--bg-panel)',
            });
        });

        test('preserves non-themed styles unchanged', () => {
            const styles = {
                margin: '10px',
                padding: 20,
                fontSize: '14px',
                display: 'flex',
                width: '100%',
            };

            const result = createDecayStyle(styles);

            expect(result).toEqual(styles);
        });

        test('handles mixed themed and non-themed styles', () => {
            const styles = {
                color: 'text-primary',
                backgroundColor: 'bg-card',
                margin: '10px',
                padding: 20,
                borderColor: 'decay-infection-green',
                fontSize: '14px',
            };

            const result = createDecayStyle(styles);

            expect(result).toEqual({
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-card)',
                margin: '10px',
                padding: 20,
                borderColor: 'var(--infection-green)',
                fontSize: '14px',
            });
        });

        test('handles empty styles object', () => {
            const result = createDecayStyle({});
            expect(result).toEqual({});
        });

        test('handles numeric values correctly', () => {
            const styles = {
                fontSize: 16,
                lineHeight: 1.5,
                zIndex: 10,
                opacity: 0.8,
            };

            const result = createDecayStyle(styles);
            expect(result).toEqual(styles);
        });

        test('only processes string values for color conversion', () => {
            const styles = {
                color: 'text-primary',
                fontSize: 16, // Should not be processed
                background: 'bg-card',
                zIndex: 100, // Should not be processed
            };

            const result = createDecayStyle(styles);

            expect(result).toEqual({
                color: 'var(--text-primary)',
                fontSize: 16,
                background: 'var(--bg-card)',
                zIndex: 100,
            });
        });
    });

    describe('DECAY_ICONS', () => {
        test('contains all expected horror-themed icons', () => {
            expect(DECAY_ICONS.skull).toBe('💀');
            expect(DECAY_ICONS.zombie).toBe('🧟');
            expect(DECAY_ICONS.virus).toBe('🦠');
            expect(DECAY_ICONS.biohazard).toBe('☣️');
            expect(DECAY_ICONS.crossBones).toBe('☠️');
        });

        test('contains biological icons', () => {
            expect(DECAY_ICONS.dna).toBe('🧬');
            expect(DECAY_ICONS.microbe).toBe('🦠');
            expect(DECAY_ICONS.brain).toBe('🧠');
            expect(DECAY_ICONS.heart).toBe('❤️');
            expect(DECAY_ICONS.blood).toBe('🩸');
            expect(DECAY_ICONS.bone).toBe('🦴');
        });

        test('contains medical/scientific icons', () => {
            expect(DECAY_ICONS.syringe).toBe('💉');
            expect(DECAY_ICONS.pill).toBe('💊');
            expect(DECAY_ICONS.radiation).toBe('☢️');
            expect(DECAY_ICONS.warning).toBe('⚠️');
        });

        test('contains creature icons', () => {
            expect(DECAY_ICONS.spider).toBe('🕷️');
            expect(DECAY_ICONS.bat).toBe('🦇');
            expect(DECAY_ICONS.rat).toBe('🐀');
            expect(DECAY_ICONS.snake).toBe('🐍');
            expect(DECAY_ICONS.scorpion).toBe('🦂');
            expect(DECAY_ICONS.ghost).toBe('👻');
        });

        test('contains action/danger icons', () => {
            expect(DECAY_ICONS.fire).toBe('🔥');
            expect(DECAY_ICONS.explosion).toBe('💥');
            expect(DECAY_ICONS.lightning).toBe('⚡');
            expect(DECAY_ICONS.knife).toBe('🔪');
        });

        test('contains tool icons', () => {
            expect(DECAY_ICONS.chainsaw).toBe('🪚');
            expect(DECAY_ICONS.axe).toBe('🪓');
            expect(DECAY_ICONS.claw).toBe('🪝');
            expect(DECAY_ICONS.shield).toBe('🛡️');
        });

        test('all icon values are single emoji strings', () => {
            Object.entries(DECAY_ICONS).forEach(([key, value]) => {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
                expect(value.length).toBeLessThanOrEqual(2); // Most emojis are 1-2 characters
            });
        });

        test('has consistent icon naming', () => {
            const keys = Object.keys(DECAY_ICONS);

            // All keys should be camelCase
            keys.forEach(key => {
                expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
            });

            // Should have a reasonable number of icons
            expect(keys.length).toBeGreaterThan(20);
            expect(keys.length).toBeLessThan(200);
        });
    });

    describe('TypeScript Types', () => {
        test('DecayColor type includes all expected values', () => {
            const testColors: DecayColor[] = [
                'flesh-dark',
                'flesh-medium',
                'flesh-light',
                'flesh-infected',
                'blood-dark',
                'blood-medium',
                'blood-bright',
                'pus-yellow',
                'pus-green',
                'bone-dark',
                'bone-medium',
                'bone-light',
                'bone-white',
                'infection-red',
                'infection-green',
                'infection-purple',
                'infection-yellow',
            ];

            // This test ensures all color values compile correctly
            testColors.forEach(color => {
                expect(getDecayColor(color)).toBe(`var(--${color})`);
            });
        });

        test('DecayTextColor type includes all expected values', () => {
            const testTextColors: DecayTextColor[] = [
                'text-primary',
                'text-secondary',
                'text-muted',
                'text-accent',
                'text-success',
                'text-warning',
                'text-error',
            ];

            testTextColors.forEach(color => {
                expect(getTextColor(color)).toBe(`var(--${color})`);
            });
        });

        test('DecayBgColor type includes all expected values', () => {
            const testBgColors: DecayBgColor[] = [
                'bg-primary',
                'bg-secondary',
                'bg-tertiary',
                'bg-panel',
                'bg-card',
            ];

            testBgColors.forEach(color => {
                expect(getBgColor(color)).toBe(`var(--${color})`);
            });
        });
    });

    describe('Theme Consistency', () => {
        test('color functions are consistent with CSS variable naming', () => {
            const testColor: DecayColor = 'flesh-infected';
            const result = getDecayColor(testColor);

            expect(result).toBe('var(--flesh-infected)');
            expect(result).toMatch(/^var\(--[a-z-]+\)$/);
        });

        test('text color functions follow consistent pattern', () => {
            const testColor: DecayTextColor = 'text-primary';
            const result = getTextColor(testColor);

            expect(result).toBe('var(--text-primary)');
            expect(result).toMatch(/^var\(--text-[a-z]+\)$/);
        });

        test('background color functions follow consistent pattern', () => {
            const testColor: DecayBgColor = 'bg-card';
            const result = getBgColor(testColor);

            expect(result).toBe('var(--bg-card)');
            expect(result).toMatch(/^var\(--bg-[a-z]+\)$/);
        });
    });

    describe('Style Creation Edge Cases', () => {
        test('handles malformed color strings gracefully', () => {
            const styles = {
                color: 'decay-', // Incomplete
                backgroundColor: 'text-', // Incomplete
                borderColor: 'bg-', // Incomplete
                normalProp: 'normal-value',
            };

            const result = createDecayStyle(styles);

            // Malformed strings should be left as-is
            expect(result).toEqual({
                color: 'decay-',
                backgroundColor: 'text-',
                borderColor: 'bg-',
                normalProp: 'normal-value',
            });
        });

        test('handles non-existent color references', () => {
            const styles = {
                color: 'decay-nonexistent-color',
                backgroundColor: 'text-invalid',
                borderColor: 'bg-fake',
            };

            const result = createDecayStyle(styles);

            // Should still convert even if color doesn't exist in types
            expect(result).toEqual({
                color: 'var(--nonexistent-color)',
                backgroundColor: 'var(--text-invalid)',
                borderColor: 'var(--bg-fake)',
            });
        });

        test('handles complex CSS values', () => {
            const styles = {
                background: 'linear-gradient(90deg, decay-flesh-dark 0%, decay-blood-bright 100%)',
                boxShadow: '0 0 10px text-accent',
                border: '1px solid bg-panel',
            };

            const result = createDecayStyle(styles);

            // Should not process complex CSS values
            expect(result).toEqual(styles);
        });

        test('preserves object structure', () => {
            const styles = {
                a: 'text-primary',
                b: {
                    nested: 'value'
                },
                c: ['array', 'values'],
            };

            const result = createDecayStyle(styles as any);

            expect(result.a).toBe('var(--text-primary)');
            expect(result.b).toEqual({ nested: 'value' });
            expect(result.c).toEqual(['array', 'values']);
        });
    });

    describe('Performance', () => {
        test('processes large style objects efficiently', () => {
            const largeStyles = Object.fromEntries(
                Array.from({ length: 1000 }, (_, i) => [
                    `prop${i}`,
                    i % 3 === 0 ? 'text-primary' : i % 3 === 1 ? 'bg-card' : `value${i}`
                ])
            );

            const startTime = performance.now();
            const result = createDecayStyle(largeStyles);
            const endTime = performance.now();

            const processingTime = endTime - startTime;
            expect(processingTime).toBeLessThan(100); // Should complete within 100ms

            expect(Object.keys(result)).toHaveLength(1000);
        });

        test('color functions execute quickly', () => {
            const startTime = performance.now();

            for (let i = 0; i < 10000; i++) {
                getDecayColor('flesh-dark');
                getTextColor('text-primary');
                getBgColor('bg-card');
            }

            const endTime = performance.now();
            const processingTime = endTime - startTime;

            expect(processingTime).toBeLessThan(100); // Should complete within 100ms
        });
    });
});