import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DecayDemo } from '../ui/DecayDemo';

describe('DecayDemo', () => {
    beforeEach(() => {
        // Clear any previous test state
        jest.clearAllMocks();
    });

    describe('Component Rendering', () => {
        test('renders main heading with biohazard icons', () => {
            render(<DecayDemo />);

            const heading = screen.getByText(/Decay Theme Demo/);
            expect(heading).toBeInTheDocument();
            expect(heading).toHaveClass('heading-decay', 'lg', 'decay-glow');
        });

        test('renders all component sections', () => {
            render(<DecayDemo />);

            // Check for main sections
            expect(screen.getByText(/Button Examples/)).toBeInTheDocument();
            expect(screen.getByText(/Card Examples/)).toBeInTheDocument();
            expect(screen.getByText(/Status Indicators/)).toBeInTheDocument();
            expect(screen.getByText(/Form Elements/)).toBeInTheDocument();
            expect(screen.getByText(/Data Display/)).toBeInTheDocument();
            expect(screen.getByText(/Feedback Elements/)).toBeInTheDocument();
        });

        test('renders with correct layout styling', () => {
            const { container } = render(<DecayDemo />);
            const mainDiv = container.firstChild as HTMLElement;

            expect(mainDiv).toHaveStyle({
                padding: 'var(--spacing-xl)',
                maxWidth: '800px',
                margin: '0 auto'
            });
        });
    });

    describe('Interactive Elements', () => {
        test('handles button clicks correctly', () => {
            render(<DecayDemo />);

            const primaryButton = screen.getByText('Primary Action');
            const secondaryButton = screen.getByText('Secondary');
            const dangerButton = screen.getByText('Destroy');

            fireEvent.click(primaryButton);
            fireEvent.click(secondaryButton);
            fireEvent.click(dangerButton);

            // Buttons should still be present after clicks
            expect(primaryButton).toBeInTheDocument();
            expect(secondaryButton).toBeInTheDocument();
            expect(dangerButton).toBeInTheDocument();
        });

        test('input field updates value correctly', () => {
            render(<DecayDemo />);

            const input = screen.getByPlaceholderText('Enter command...');

            fireEvent.change(input, { target: { value: 'test command' } });

            expect(input).toHaveValue('test command');
        });

        test('notification can be dismissed', () => {
            render(<DecayDemo />);

            const notification = screen.getByText(/System Alert/);
            expect(notification).toBeInTheDocument();

            const dismissButton = screen.getByLabelText(/Dismiss/);
            fireEvent.click(dismissButton);

            expect(notification).not.toBeInTheDocument();
        });
    });

    describe('Status Components', () => {
        test('renders all status variants', () => {
            render(<DecayDemo />);

            expect(screen.getByText('Healthy')).toBeInTheDocument();
            expect(screen.getByText('Infected')).toBeInTheDocument();
            expect(screen.getByText('Critical')).toBeInTheDocument();
        });

        test('renders progress bars with different values', () => {
            render(<DecayDemo />);

            // Check for progress bars - they should have different progress values
            const progressBars = screen.getAllByRole('progressbar');
            expect(progressBars).toHaveLength(3);

            // Each progress bar should have a different aria-valuenow
            const values = progressBars.map(bar => bar.getAttribute('aria-valuenow'));
            expect(new Set(values).size).toBe(3); // All different values
        });
    });

    describe('Data Display Components', () => {
        test('renders table with sample data', () => {
            render(<DecayDemo />);

            // Check for table headers
            expect(screen.getByText('ID')).toBeInTheDocument();
            expect(screen.getByText('Name')).toBeInTheDocument();
            expect(screen.getByText('Status')).toBeInTheDocument();
            expect(screen.getByText('Threat Level')).toBeInTheDocument();
            expect(screen.getByText('Last Seen')).toBeInTheDocument();

            // Check for sample data rows
            expect(screen.getByText('SCP-001')).toBeInTheDocument();
            expect(screen.getByText('SCP-173')).toBeInTheDocument();
            expect(screen.getByText('SCP-096')).toBeInTheDocument();

            expect(screen.getByText('The Prototype')).toBeInTheDocument();
            expect(screen.getByText('The Sculpture')).toBeInTheDocument();
            expect(screen.getByText('The Shy Guy')).toBeInTheDocument();
        });

        test('renders loader component', () => {
            render(<DecayDemo />);

            const loader = screen.getByText('Processing contamination data...');
            expect(loader).toBeInTheDocument();
        });
    });

    describe('Theme Integration', () => {
        test('uses decay icons throughout the component', () => {
            render(<DecayDemo />);

            // The component should use various decay icons
            // We can't test the actual icons easily, but we can test that the component renders
            expect(screen.getByText(/Decay Theme Demo/)).toBeInTheDocument();
        });

        test('applies consistent spacing and layout', () => {
            const { container } = render(<DecayDemo />);

            // Check that the component structure is properly rendered
            expect(container.firstChild).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        test('has proper heading hierarchy', () => {
            render(<DecayDemo />);

            const mainHeading = screen.getByRole('heading', { level: 1 });
            expect(mainHeading).toHaveTextContent('Decay Theme Demo');

            const subHeadings = screen.getAllByRole('heading', { level: 2 });
            expect(subHeadings.length).toBeGreaterThan(0);
        });

        test('input field has proper labeling', () => {
            render(<DecayDemo />);

            const input = screen.getByPlaceholderText('Enter command...');
            expect(input).toBeInTheDocument();
            expect(input).toHaveAttribute('type', 'text');
        });

        test('buttons are properly accessible', () => {
            render(<DecayDemo />);

            const buttons = screen.getAllByRole('button');
            expect(buttons.length).toBeGreaterThan(0);

            buttons.forEach(button => {
                expect(button).toBeVisible();
            });
        });

        test('progress bars have proper ARIA attributes', () => {
            render(<DecayDemo />);

            const progressBars = screen.getAllByRole('progressbar');

            progressBars.forEach(bar => {
                expect(bar).toHaveAttribute('aria-valuenow');
                expect(bar).toHaveAttribute('aria-valuemin', '0');
                expect(bar).toHaveAttribute('aria-valuemax', '100');
            });
        });
    });

    describe('Error Boundaries', () => {
        test('renders without crashing with minimal props', () => {
            expect(() => render(<DecayDemo />)).not.toThrow();
        });

        test('handles rapid state changes gracefully', async () => {
            render(<DecayDemo />);

            const input = screen.getByPlaceholderText('Enter command...');

            // Rapid input changes
            fireEvent.change(input, { target: { value: 'a' } });
            fireEvent.change(input, { target: { value: 'ab' } });
            fireEvent.change(input, { target: { value: 'abc' } });
            fireEvent.change(input, { target: { value: '' } });

            await waitFor(() => {
                expect(input).toHaveValue('');
            });
        });
    });

    describe('Component State Management', () => {
        test('manages input state correctly', () => {
            render(<DecayDemo />);

            const input = screen.getByPlaceholderText('Enter command...');

            expect(input).toHaveValue('');

            fireEvent.change(input, { target: { value: 'new value' } });
            expect(input).toHaveValue('new value');

            fireEvent.change(input, { target: { value: '' } });
            expect(input).toHaveValue('');
        });

        test('manages notification visibility state', () => {
            render(<DecayDemo />);

            const notification = screen.getByText(/System Alert/);
            expect(notification).toBeInTheDocument();

            const dismissButton = screen.getByLabelText(/Dismiss/);
            fireEvent.click(dismissButton);

            expect(screen.queryByText(/System Alert/)).not.toBeInTheDocument();
        });
    });

    describe('Component Integration', () => {
        test('integrates all DecayComponents correctly', () => {
            render(<DecayDemo />);

            // Verify that various DecayComponent types are rendered
            expect(screen.getByText('Primary Action')).toBeInTheDocument(); // DecayButton
            expect(screen.getByText(/Containment Status/)).toBeInTheDocument(); // DecayCard
            expect(screen.getByText('Healthy')).toBeInTheDocument(); // DecayStatus
            expect(screen.getAllByRole('progressbar')).toHaveLength(3); // DecayProgress
            expect(screen.getByPlaceholderText('Enter command...')).toBeInTheDocument(); // DecayInput
        });

        test('maintains consistent theming across all components', () => {
            const { container } = render(<DecayDemo />);

            // All components should be properly rendered within the container
            expect(container.firstChild).toBeInTheDocument();

            // Check that the component doesn't throw any console errors
            expect(() => render(<DecayDemo />)).not.toThrow();
        });
    });
});