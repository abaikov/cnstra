import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ResponseDataViewer } from '../ResponseDataViewer';

describe('ResponseDataViewer', () => {
    it('renders with no data', () => {
        render(<ResponseDataViewer data={{}} />);
        expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('renders with input payload only', () => {
        const data = {
            inputPayload: { test: 'input data' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📊 Response Data')).toBeInTheDocument();
        expect(screen.getByText('📥 Input Signal')).toBeInTheDocument();
    });

    it('renders with output payload only', () => {
        const data = {
            outputPayload: { test: 'output data' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📊 Response Data')).toBeInTheDocument();
        expect(screen.getByText('📤 Output Signal')).toBeInTheDocument();
    });

    it('renders with contexts only', () => {
        const data = {
            contexts: { user: 'john', session: 'abc123' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📊 Response Data')).toBeInTheDocument();
        expect(screen.getByText('🧠 Contexts')).toBeInTheDocument();
    });

    it('renders with input and output contexts', () => {
        const data = {
            inputContexts: { before: 'state' },
            outputContexts: { after: 'state' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📊 Response Data')).toBeInTheDocument();
        expect(screen.getByText('🧠 Input Context')).toBeInTheDocument();
        expect(screen.getByText('🧠 Output Context')).toBeInTheDocument();
    });

    it('renders with snapshot data', () => {
        const data = {
            snapshot: { memory: 'usage', cpu: 'load' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📊 Response Data')).toBeInTheDocument();
        expect(screen.getByText('📸 Data Snapshot')).toBeInTheDocument();
    });

    it('renders with all data types', () => {
        const data = {
            inputPayload: { test: 'input' },
            outputPayload: { test: 'output' },
            inputContexts: { before: 'state' },
            outputContexts: { after: 'state' },
            snapshot: { memory: 'usage' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📊 Response Data')).toBeInTheDocument();
        expect(screen.getByText('📥 Input Signal')).toBeInTheDocument();
        expect(screen.getByText('📤 Output Signal')).toBeInTheDocument();
        expect(screen.getByText('🧠 Input Context')).toBeInTheDocument();
        expect(screen.getByText('🧠 Output Context')).toBeInTheDocument();
        expect(screen.getByText('📸 Data Snapshot')).toBeInTheDocument();
    });

    it('expands and collapses on click', () => {
        const data = {
            inputPayload: { test: 'input' },
        };
        render(<ResponseDataViewer data={data} />);

        // Initially collapsed
        expect(screen.queryByText('📥 Input Signal')).not.toBeInTheDocument();

        // Click to expand
        fireEvent.click(screen.getByText('📊 Response Data'));
        expect(screen.getByText('📥 Input Signal')).toBeInTheDocument();

        // Click to collapse
        fireEvent.click(screen.getByText('📊 Response Data'));
        expect(screen.queryByText('📥 Input Signal')).not.toBeInTheDocument();
    });

    it('renders with custom title', () => {
        const data = {
            inputPayload: { test: 'input' },
        };
        render(<ResponseDataViewer data={data} title="Custom Title" />);
        expect(screen.getByText('📊 Custom Title')).toBeInTheDocument();
    });

    it('renders expanded by default when defaultExpanded is true', () => {
        const data = {
            inputPayload: { test: 'input' },
        };
        render(<ResponseDataViewer data={data} defaultExpanded={true} />);
        expect(screen.getByText('📥 Input Signal')).toBeInTheDocument();
    });
});
