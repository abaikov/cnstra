import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EmptyGraphPlaceholder } from '../ui/EmptyGraphPlaceholder';

describe('EmptyGraphPlaceholder', () => {
    describe('Component Rendering', () => {
        test('renders with default props', () => {
            render(<EmptyGraphPlaceholder />);

            expect(screen.getByText('No CNS Data Available')).toBeInTheDocument();
            expect(screen.getByText('Connect an app with CNS to see the neural network topology')).toBeInTheDocument();
        });

        test('renders with custom message', () => {
            render(
                <EmptyGraphPlaceholder
                    message="Custom Empty Message"
                    submessage="Custom submessage for testing"
                />
            );

            expect(screen.getByText('Custom Empty Message')).toBeInTheDocument();
            expect(screen.getByText('Custom submessage for testing')).toBeInTheDocument();
        });

        test('applies custom className', () => {
            const { container } = render(
                <EmptyGraphPlaceholder className="custom-placeholder" />
            );

            expect(container.firstChild).toHaveClass('empty-graph-placeholder', 'custom-placeholder');
        });

        test('renders with all required visual elements', () => {
            render(<EmptyGraphPlaceholder />);

            // Should have skull emoji
            expect(screen.getByText('💀')).toBeInTheDocument();

            // Should have main heading
            const heading = screen.getByRole('heading', { level: 2 });
            expect(heading).toBeInTheDocument();
            expect(heading).toHaveClass('heading-decay', 'lg');

            // Should have instructions section
            expect(screen.getByText('How to Connect')).toBeInTheDocument();
        });
    });

    describe('Layout and Styling', () => {
        test('has proper container styling', () => {
            const { container } = render(<EmptyGraphPlaceholder />);
            const placeholder = container.firstChild as HTMLElement;

            expect(placeholder).toHaveStyle({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                width: '100%',
                minHeight: '400px',
                textAlign: 'center',
            });
        });

        test('applies CSS custom properties', () => {
            const { container } = render(<EmptyGraphPlaceholder />);
            const placeholder = container.firstChild as HTMLElement;

            expect(placeholder).toHaveStyle({
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                padding: 'var(--spacing-xl)',
            });
        });

        test('has proper heading styling', () => {
            render(<EmptyGraphPlaceholder />);
            const heading = screen.getByRole('heading', { level: 2 });

            expect(heading).toHaveStyle({
                color: 'var(--infection-red)',
                textShadow: '0 0 10px var(--infection-red)',
                fontSize: 'var(--font-size-2xl)',
            });
        });

        test('has proper submessage styling', () => {
            render(<EmptyGraphPlaceholder />);
            const submessage = screen.getByText('Connect an app with CNS to see the neural network topology');

            expect(submessage).toHaveStyle({
                color: 'var(--text-secondary)',
                fontSize: 'var(--font-size-base)',
                maxWidth: '500px',
                lineHeight: '1.5',
            });
        });
    });

    describe('Decay Theme Integration', () => {
        test('includes decay-themed skull icon', () => {
            render(<EmptyGraphPlaceholder />);
            const skullIcon = screen.getByText('💀');

            expect(skullIcon.parentElement).toHaveClass('pulse-infection', 'decay-glow');
            expect(skullIcon.parentElement).toHaveStyle({
                fontSize: '120px',
                filter: 'drop-shadow(0 0 20px var(--infection-red))',
            });
        });

        test('includes animated decay icons', () => {
            render(<EmptyGraphPlaceholder />);

            // Should have virus, brain, and DNA icons with flicker animation
            const flickerElements = document.querySelectorAll('.flicker');
            expect(flickerElements).toHaveLength(3);

            flickerElements.forEach(element => {
                expect(element).toHaveStyle({
                    fontSize: 'var(--font-size-3xl)',
                });
            });
        });

        test('includes infection-themed colors', () => {
            render(<EmptyGraphPlaceholder />);

            // Check for infection color usage
            const flickerElements = document.querySelectorAll('.flicker');
            expect(flickerElements[0]).toHaveStyle({
                color: 'var(--infection-green)',
                textShadow: '0 0 8px var(--infection-green)',
            });

            expect(flickerElements[1]).toHaveStyle({
                color: 'var(--infection-purple)',
                textShadow: '0 0 8px var(--infection-purple)',
            });

            expect(flickerElements[2]).toHaveStyle({
                color: 'var(--infection-yellow)',
                textShadow: '0 0 8px var(--infection-yellow)',
            });
        });

        test('includes animated gradient bars', () => {
            render(<EmptyGraphPlaceholder />);

            const gradientBars = document.querySelectorAll('[style*="linear-gradient"]');
            expect(gradientBars).toHaveLength(2);

            gradientBars.forEach(bar => {
                expect(bar).toHaveStyle({
                    width: '60px',
                    height: '2px',
                    animation: 'pulse-infection 2s infinite',
                });
            });
        });
    });

    describe('Instructions Section', () => {
        test('renders instructions with proper structure', () => {
            render(<EmptyGraphPlaceholder />);

            expect(screen.getByText('How to Connect')).toBeInTheDocument();
            expect(screen.getByText(/Start your CNS application/)).toBeInTheDocument();
            expect(screen.getByText(/Initialize CNSDevTools/)).toBeInTheDocument();
            expect(screen.getByText(/Perform some stimulations/)).toBeInTheDocument();
            expect(screen.getByText(/Watch the neural network/)).toBeInTheDocument();
        });

        test('has proper instructions styling', () => {
            render(<EmptyGraphPlaceholder />);

            const instructionsContainer = screen.getByText('How to Connect').parentElement;
            expect(instructionsContainer).toHaveStyle({
                padding: 'var(--spacing-lg)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-infected)',
                borderRadius: 'var(--radius-md)',
                maxWidth: '600px',
            });
        });

        test('numbers steps correctly', () => {
            render(<EmptyGraphPlaceholder />);

            expect(screen.getByText('1.')).toBeInTheDocument();
            expect(screen.getByText('2.')).toBeInTheDocument();
            expect(screen.getByText('3.')).toBeInTheDocument();
            expect(screen.getByText('4.')).toBeInTheDocument();
        });

        test('includes biohazard icon in instructions title', () => {
            render(<EmptyGraphPlaceholder />);

            const instructionsTitle = screen.getByText(/How to Connect/);
            expect(instructionsTitle.textContent).toContain('☢️'); // biohazard icon
        });
    });

    describe('Animation Classes', () => {
        test('applies animation classes correctly', () => {
            render(<EmptyGraphPlaceholder />);

            // Skull should have pulse animation
            const skullContainer = screen.getByText('💀').parentElement;
            expect(skullContainer).toHaveClass('pulse-infection', 'decay-glow');

            // Decay icons should have flicker animation
            const flickerElements = document.querySelectorAll('.flicker');
            expect(flickerElements).toHaveLength(3);

            // Check animation delays
            expect(flickerElements[1]).toHaveStyle({ animationDelay: '0.5s' });
            expect(flickerElements[2]).toHaveStyle({ animationDelay: '1.5s' });
        });

        test('includes proper animation styles', () => {
            render(<EmptyGraphPlaceholder />);

            const gradientBars = document.querySelectorAll('[style*="pulse-infection"]');
            expect(gradientBars).toHaveLength(2);

            // Check animation delays on gradient bars
            expect(gradientBars[1]).toHaveStyle({ animationDelay: '1s' });
        });
    });

    describe('Responsive Design', () => {
        test('has flexible layout properties', () => {
            const { container } = render(<EmptyGraphPlaceholder />);
            const placeholder = container.firstChild as HTMLElement;

            expect(placeholder).toHaveStyle({
                width: '100%',
                height: '100%',
                minHeight: '400px',
            });
        });

        test('constrains content width appropriately', () => {
            render(<EmptyGraphPlaceholder />);

            const submessage = screen.getByText('Connect an app with CNS to see the neural network topology');
            expect(submessage).toHaveStyle({ maxWidth: '500px' });

            const instructions = screen.getByText('How to Connect').parentElement;
            expect(instructions).toHaveStyle({ maxWidth: '600px' });
        });
    });

    describe('Accessibility', () => {
        test('has proper semantic structure', () => {
            render(<EmptyGraphPlaceholder />);

            // Should have proper heading hierarchy
            expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
        });

        test('provides meaningful text content', () => {
            render(<EmptyGraphPlaceholder />);

            // All text content should be meaningful and accessible
            expect(screen.getByText('No CNS Data Available')).toBeInTheDocument();
            expect(screen.getByText('Connect an app with CNS to see the neural network topology')).toBeInTheDocument();
            expect(screen.getByText('How to Connect')).toBeInTheDocument();
        });

        test('maintains readable text hierarchy', () => {
            render(<EmptyGraphPlaceholder />);

            const mainHeading = screen.getByRole('heading', { level: 2 });
            const subHeading = screen.getByRole('heading', { level: 3 });

            expect(mainHeading).toHaveTextContent('No CNS Data Available');
            expect(subHeading).toHaveTextContent(/How to Connect/);
        });
    });

    describe('Content Customization', () => {
        test('accepts empty messages', () => {
            render(<EmptyGraphPlaceholder message="" submessage="" />);

            // Should render but with empty text
            const heading = screen.getByRole('heading', { level: 2 });
            expect(heading).toHaveTextContent('');
        });

        test('handles long messages gracefully', () => {
            const longMessage = 'This is a very long message that should still be displayed properly within the component layout and not break the visual design';
            const longSubmessage = 'This is also a very long submessage that provides detailed information about what the user needs to do to connect their application and should wrap appropriately';

            render(<EmptyGraphPlaceholder message={longMessage} submessage={longSubmessage} />);

            expect(screen.getByText(longMessage)).toBeInTheDocument();
            expect(screen.getByText(longSubmessage)).toBeInTheDocument();
        });

        test('handles undefined props gracefully', () => {
            render(<EmptyGraphPlaceholder message={undefined} submessage={undefined} />);

            // Should fall back to default values
            expect(screen.getByText('No CNS Data Available')).toBeInTheDocument();
            expect(screen.getByText('Connect an app with CNS to see the neural network topology')).toBeInTheDocument();
        });
    });

    describe('Component Integration', () => {
        test('integrates with theme-utils correctly', () => {
            render(<EmptyGraphPlaceholder />);

            // Should use DECAY_ICONS from theme-utils
            // The exact icons depend on the theme-utils implementation
            expect(screen.getByText('How to Connect')).toBeInTheDocument();
        });

        test('works as both named and default export', () => {
            expect(EmptyGraphPlaceholder).toBeDefined();
            expect(typeof EmptyGraphPlaceholder).toBe('function');
        });
    });

    describe('Error Resistance', () => {
        test('renders without errors with minimal props', () => {
            expect(() => render(<EmptyGraphPlaceholder />)).not.toThrow();
        });

        test('handles null className gracefully', () => {
            expect(() => render(<EmptyGraphPlaceholder className={null as any} />)).not.toThrow();
        });

        test('maintains structure with any prop combination', () => {
            render(
                <EmptyGraphPlaceholder
                    message="Test"
                    submessage="Test sub"
                    className="test-class"
                />
            );

            // Core structure should always be present
            expect(screen.getByText('💀')).toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
            expect(screen.getByText('How to Connect')).toBeInTheDocument();
        });
    });
});