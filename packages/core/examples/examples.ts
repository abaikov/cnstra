import { CNS, collateral, neuron } from '../src/index';

/**
 * Example 1: Simple User Registration Flow
 * Demonstrates basic signal flow - only returned signals are processed
 */
export async function userRegistrationExample() {
    console.log('\n=== User Registration Example ===');
    console.log('Note: Only the returned signal is processed by CNS');

    // Define collaterals
    const userCreated = collateral<{ id: string; email: string; name: string }>(
        'user:created'
    );
    const userRegistered = collateral<{ userId: string; status: string }>(
        'user:registered'
    );

    // Create neuron - only one output collateral
    const userService = neuron('user-service', {
        userRegistered,
    }).dendrite({
        collateral: userCreated,
        reaction: async (payload, axon) => {
            const userData = payload as {
                id: string;
                email: string;
                name: string;
            };
            console.log(`Processing user creation for: ${userData.email}`);

            // Only this returned signal is processed and propagated
            return axon.userRegistered.createSignal({
                userId: userData.id,
                status: 'completed',
            });
        },
    });

    const cns = new CNS({ userCreated }, [userService]);

    // Stimulate the system
    const traces: Array<{ edgeId: string; hops: number; payload: unknown }> =
        [];

    await cns.stimulate(
        'userCreated',
        {
            type: 'userCreated',
            id: '123',
            email: 'john@example.com',
            name: 'John Doe',
        } as any,
        {
            onTrace: trace => {
                traces.push(trace);
                console.log(`Signal: ${trace.edgeId} at hop ${trace.hops}`);
            },
        }
    );

    console.log(`Total signals processed: ${traces.length}`);
    console.log(
        'Only userRegistered signal was processed (returned from reaction)'
    );
    return traces;
}

/**
 * Example 2: Data Processing with Validation
 * Demonstrates conditional logic and data transformation
 */
export async function dataProcessingExample() {
    console.log('\n=== Data Processing Example ===');

    // Define collaterals
    const rawData = collateral<{ value: number; timestamp: number }>(
        'raw:data'
    );
    const processed = collateral<{ result: number; processingTime: number }>(
        'data:processed'
    );
    const error = collateral<{ error: string; originalValue: number }>(
        'data:error'
    );

    // Create processing neuron
    const processor = neuron('processor', { processed, error }).dendrite({
        collateral: rawData,
        reaction: async (payload, axon) => {
            const data = payload as { value: number; timestamp: number };
            console.log(`Processing data: ${data.value}`);

            if (data.value <= 0 || data.value >= 1000) {
                return axon.error.createSignal({
                    error: 'Value out of valid range (0-1000)',
                    originalValue: data.value,
                });
            }

            const startTime = Date.now();

            // Simulate processing
            await new Promise(resolve => setTimeout(resolve, 50));

            const processingTime = Date.now() - startTime;
            return axon.processed.createSignal({
                result: data.value * 2 + 10,
                processingTime,
            });
        },
    });

    const cns = new CNS({ rawData }, [processor]);

    // Process multiple data points
    const testValues = [5, 100, -5, 1500, 42];
    const results = [];

    for (const value of testValues) {
        const traces: Array<{
            edgeId: string;
            hops: number;
            payload: unknown;
        }> = [];

        await cns.stimulate(
            'rawData',
            {
                type: 'rawData',
                value,
                timestamp: Date.now(),
            } as any,
            {
                onTrace: trace => traces.push(trace),
            }
        );

        results.push({ value, traces });
    }

    console.log(`Processed ${testValues.length} data points`);
    return results;
}

/**
 * Example 3: Conditional Routing
 * Demonstrates conditional logic and error handling patterns
 */
export async function conditionalRoutingExample() {
    console.log('\n=== Conditional Routing Example ===');

    // Define collaterals
    const request = collateral<{
        type: 'read' | 'write' | 'delete';
        data: any;
    }>('api:request');
    const success = collateral<{ result: any; timestamp: number }>(
        'api:success'
    );
    const error = collateral<{ error: string; code: number }>('api:error');

    // Create router neuron
    const apiRouter = neuron('api-router', { success, error }).dendrite({
        collateral: request,
        reaction: async (payload, axon) => {
            const req = payload as {
                type: 'read' | 'write' | 'delete';
                data: any;
            };
            console.log(`Routing API request: ${req.type}`);

            try {
                let result;

                switch (req.type) {
                    case 'read':
                        result = {
                            data: `Read data: ${JSON.stringify(req.data)}`,
                        };
                        break;
                    case 'write':
                        result = {
                            data: `Wrote data: ${JSON.stringify(req.data)}`,
                        };
                        break;
                    case 'delete':
                        if (req.data.id === 'protected') {
                            throw new Error('Cannot delete protected resource');
                        }
                        result = {
                            data: `Deleted data: ${JSON.stringify(req.data)}`,
                        };
                        break;
                    default:
                        throw new Error(`Unknown operation: ${req.type}`);
                }

                return axon.success.createSignal({
                    result,
                    timestamp: Date.now(),
                });
            } catch (err) {
                return axon.error.createSignal({
                    error: err instanceof Error ? err.message : 'Unknown error',
                    code: 500,
                });
            }
        },
    });

    const cns = new CNS({ request }, [apiRouter]);

    // Test different scenarios
    const scenarios = [
        { type: 'read' as const, data: { id: '123' } },
        { type: 'write' as const, data: { name: 'test', value: 42 } },
        { type: 'delete' as const, data: { id: 'protected' } },
        { type: 'delete' as const, data: { id: 'safe' } },
    ];

    const results = [];
    for (const scenario of scenarios) {
        const traces: Array<{
            edgeId: string;
            hops: number;
            payload: unknown;
        }> = [];

        await cns.stimulate(
            'request',
            {
                ...scenario,
            } as any,
            {
                onTrace: trace => traces.push(trace),
            }
        );

        results.push({ scenario, traces });
    }

    console.log(`Processed ${scenarios.length} scenarios`);
    return results;
}

/**
 * Example 4: Fan-Out Pattern
 * Demonstrates that only returned signals are processed
 */
export async function fanOutExample() {
    console.log('\n=== Fan-Out Pattern Example ===');
    console.log('Note: Only the returned signal is processed by CNS');

    // Define collaterals
    const broadcast = collateral<{
        message: string;
        priority: 'low' | 'medium' | 'high';
    }>('system:broadcast');
    const metrics = collateral<{ metric: string; value: number }>(
        'system:metrics'
    );

    // Create neuron - only one output collateral
    const broadcastService = neuron('broadcast-service', {
        metrics,
    }).dendrite({
        collateral: broadcast,
        reaction: async (payload, axon) => {
            const msg = payload as {
                message: string;
                priority: 'low' | 'medium' | 'high';
            };
            console.log(`Broadcasting message: ${msg.message}`);

            // In a real application, you would do the actual work here:
            // - Log to system logger
            // - Send notifications
            // - Update metrics
            // But CNS only processes the returned signal

            // Only this returned signal is processed and propagated
            return axon.metrics.createSignal({
                metric: 'broadcast_count',
                value: 1,
            });
        },
    });

    const cns = new CNS({ broadcast }, [broadcastService]);

    // Send broadcast messages
    const messages = [
        { message: 'System startup completed', priority: 'low' as const },
        {
            message: 'Database connection restored',
            priority: 'medium' as const,
        },
        { message: 'Critical error detected', priority: 'high' as const },
    ];

    const results = [];
    for (const message of messages) {
        const traces: Array<{
            edgeId: string;
            hops: number;
            payload: unknown;
        }> = [];

        await cns.stimulate(
            'broadcast',
            {
                type: 'broadcast',
                ...message,
            } as any,
            {
                onTrace: trace => traces.push(trace),
            }
        );

        results.push({ message, traces });
    }

    console.log(`Broadcasted ${messages.length} messages`);
    console.log(
        'Only metrics signals were processed (returned from reactions)'
    );
    return results;
}

/**
 * Example 5: Async Operations
 * Demonstrates async reactions and timeout handling
 */
export async function asyncOperationsExample() {
    console.log('\n=== Async Operations Example ===');

    // Define collaterals
    const start = collateral<{ taskId: string; delay: number }>('task:start');
    const complete = collateral<{
        taskId: string;
        result: string;
        duration: number;
    }>('task:complete');
    const timeout = collateral<{ taskId: string; reason: string }>(
        'task:timeout'
    );

    // Create task processor neuron
    const taskProcessor = neuron('task-processor', {
        complete,
        timeout,
    }).dendrite({
        collateral: start,
        reaction: async (payload, axon) => {
            const task = payload as { taskId: string; delay: number };
            console.log(`Starting task: ${task.taskId}`);

            try {
                const startTime = Date.now();

                // Simulate work with timeout
                await new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        reject(new Error('Task timeout'));
                    }, task.delay + 50); // Add buffer for timeout

                    // Simulate work
                    setTimeout(() => {
                        clearTimeout(timeoutId);
                        resolve('Task completed successfully');
                    }, task.delay);
                });

                const duration = Date.now() - startTime;
                return axon.complete.createSignal({
                    taskId: task.taskId,
                    result: 'Task completed successfully',
                    duration,
                });
            } catch (err) {
                return axon.timeout.createSignal({
                    taskId: task.taskId,
                    reason:
                        err instanceof Error ? err.message : 'Unknown error',
                });
            }
        },
    });

    const cns = new CNS({ start }, [taskProcessor]);

    // Test with different delays
    const tasks = [
        { taskId: 'task-1', delay: 100 },
        { taskId: 'task-2', delay: 200 },
        { taskId: 'task-3', delay: 50 },
    ];

    const results = [];
    for (const task of tasks) {
        const traces: Array<{
            edgeId: string;
            hops: number;
            payload: unknown;
        }> = [];

        await cns.stimulate(
            'start',
            {
                type: 'start',
                ...task,
            } as any,
            {
                onTrace: trace => traces.push(trace),
            }
        );

        results.push({ task, traces });
    }

    console.log(`Processed ${tasks.length} tasks`);
    return results;
}

/**
 * Example 6: Multiple Outputs Through Neuron Chains
 * Demonstrates how to achieve multiple outputs by chaining neurons
 */
export async function multipleOutputsExample() {
    console.log('\n=== Multiple Outputs Through Neuron Chains ===');
    console.log(
        'This shows how to achieve multiple outputs by chaining neurons'
    );

    // Define collaterals
    const userCreated = collateral<{ id: string; email: string; name: string }>(
        'user:created'
    );
    const emailSent = collateral<{ to: string; subject: string; body: string }>(
        'email:sent'
    );
    const notificationSent = collateral<{ userId: string; message: string }>(
        'notification:sent'
    );
    const userRegistered = collateral<{ userId: string; status: string }>(
        'user:registered'
    );

    // Create a chain of neurons, each handling one responsibility
    const emailService = neuron('email-service', {
        emailSent,
    }).dendrite({
        collateral: userCreated,
        reaction: async (payload, axon) => {
            const userData = payload as {
                id: string;
                email: string;
                name: string;
            };
            console.log(`Sending welcome email to: ${userData.email}`);

            return axon.emailSent.createSignal({
                to: userData.email,
                subject: 'Welcome to our platform!',
                body: `Hello ${userData.name}, welcome to our platform!`,
            });
        },
    });

    const notificationService = neuron('notification-service', {
        notificationSent,
    }).dendrite({
        collateral: userCreated,
        reaction: async (payload, axon) => {
            const userData = payload as {
                id: string;
                email: string;
                name: string;
            };
            console.log(`Sending notification for user: ${userData.id}`);

            return axon.notificationSent.createSignal({
                userId: userData.id,
                message: 'Account created successfully',
            });
        },
    });

    const registrationService = neuron('registration-service', {
        userRegistered,
    }).dendrite({
        collateral: userCreated,
        reaction: async (payload, axon) => {
            const userData = payload as {
                id: string;
                email: string;
                name: string;
            };
            console.log(`Completing registration for user: ${userData.id}`);

            return axon.userRegistered.createSignal({
                userId: userData.id,
                status: 'completed',
            });
        },
    });

    // Create separate CNS instances for each neuron to avoid type conflicts
    const emailCNS = new CNS({ userCreated }, [emailService]);
    const notificationCNS = new CNS({ userCreated }, [notificationService]);
    const registrationCNS = new CNS({ userCreated }, [registrationService]);

    // Stimulate each system separately
    const allTraces: Array<{ edgeId: string; hops: number; payload: unknown }> =
        [];

    // Process email
    const emailTraces: Array<{
        edgeId: string;
        hops: number;
        payload: unknown;
    }> = [];
    await emailCNS.stimulate(
        'userCreated',
        {
            type: 'userCreated',
            id: '123',
            email: 'john@example.com',
            name: 'John Doe',
        } as any,
        {
            onTrace: trace => {
                emailTraces.push(trace);
                allTraces.push(trace);
                console.log(
                    `Email Signal: ${trace.edgeId} at hop ${trace.hops}`
                );
            },
        }
    );

    // Process notification
    const notificationTraces: Array<{
        edgeId: string;
        hops: number;
        payload: unknown;
    }> = [];
    await notificationCNS.stimulate(
        'userCreated',
        {
            type: 'userCreated',
            id: '123',
            email: 'john@example.com',
            name: 'John Doe',
        } as any,
        {
            onTrace: trace => {
                notificationTraces.push(trace);
                allTraces.push(trace);
                console.log(
                    `Notification Signal: ${trace.edgeId} at hop ${trace.hops}`
                );
            },
        }
    );

    // Process registration
    const registrationTraces: Array<{
        edgeId: string;
        hops: number;
        payload: unknown;
    }> = [];
    await registrationCNS.stimulate(
        'userCreated',
        {
            type: 'userCreated',
            id: '123',
            email: 'john@example.com',
            name: 'John Doe',
        } as any,
        {
            onTrace: trace => {
                registrationTraces.push(trace);
                allTraces.push(trace);
                console.log(
                    `Registration Signal: ${trace.edgeId} at hop ${trace.hops}`
                );
            },
        }
    );

    console.log(`Total signals processed: ${allTraces.length}`);
    console.log(
        'All three signals were processed because each neuron returned its signal'
    );
    console.log(
        `Email traces: ${emailTraces.length}, Notification traces: ${notificationTraces.length}, Registration traces: ${registrationTraces.length}`
    );
    return allTraces;
}

/**
 * Main function to run all examples
 */
export async function runAllExamples() {
    console.log('🚀 Running CNS Examples...\n');

    try {
        await userRegistrationExample();
        await dataProcessingExample();
        await conditionalRoutingExample();
        await fanOutExample();
        await asyncOperationsExample();
        await multipleOutputsExample(); // Added new example to runAllExamples

        console.log('\n✅ All examples completed successfully!');
    } catch (error) {
        console.error('\n❌ Error running examples:', error);
    }
}
