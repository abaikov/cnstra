/**
 * Array Signals Demo - Demonstrates returning multiple signals from a neuron
 *
 * This example shows various patterns for working with arrays of signals in CNStra.
 */

import { CNS, collateral, neuron } from '@cnstra/core';

console.log('\n🎯 ====== Array Signals Demo ====== 🎯\n');

// Define collaterals for the demo
const orderPlaced = collateral<{ orderId: string; items: string[] }>(
    'order-placed'
);
const updateInventory = collateral<{ orderId: string; item: string }>(
    'update-inventory'
);
const sendEmail = collateral<{ orderId: string; type: string }>('send-email');
const logAudit = collateral<{ orderId: string; action: string }>('log-audit');
const inventoryUpdated = collateral<{ item: string; success: boolean }>(
    'inventory-updated'
);
const emailSent = collateral<{ type: string; success: boolean }>('email-sent');
const auditLogged = collateral<{ action: string }>('audit-logged');

// Example 1: Fan-out pattern - split one signal into multiple downstream signals
const orderProcessor = neuron('order-processor', {
    updateInventory,
    sendEmail,
    logAudit,
}).dendrite({
    collateral: orderPlaced,
    response: (payload, axon) => {
        console.log(
            `📦 Processing order ${payload.orderId} with ${payload.items.length} items`
        );

        // Return an array of signals - each will be processed independently
        return [
            // Create a signal for each item to update inventory
            ...payload.items.map(item =>
                axon.updateInventory.createSignal({
                    orderId: payload.orderId,
                    item,
                })
            ),
            // Also send confirmation email
            axon.sendEmail.createSignal({
                orderId: payload.orderId,
                type: 'confirmation',
            }),
            // And log the action
            axon.logAudit.createSignal({
                orderId: payload.orderId,
                action: 'order_processed',
            }),
        ];
    },
});

// Downstream neurons that process the signals
const inventoryService = neuron('inventory-service', {
    inventoryUpdated,
}).dendrite({
    collateral: updateInventory,
    response: (payload, axon) => {
        console.log(
            `  📊 Updating inventory for item: ${payload.item} (order: ${payload.orderId})`
        );
        return axon.inventoryUpdated.createSignal({
            item: payload.item,
            success: true,
        });
    },
});

const emailService = neuron('email-service', { emailSent }).dendrite({
    collateral: sendEmail,
    response: (payload, axon) => {
        console.log(
            `  📧 Sending ${payload.type} email for order: ${payload.orderId}`
        );
        return axon.emailSent.createSignal({
            type: payload.type,
            success: true,
        });
    },
});

const auditService = neuron('audit-service', { auditLogged }).dendrite({
    collateral: logAudit,
    response: (payload, axon) => {
        console.log(
            `  📝 Logging audit: ${payload.action} for order: ${payload.orderId}`
        );
        return axon.auditLogged.createSignal({ action: payload.action });
    },
});

// Terminal neurons (no output signals)
const inventoryConfirmer = neuron('inventory-confirmer', {}).dendrite({
    collateral: inventoryUpdated,
    response: payload => {
        console.log(`    ✅ Inventory confirmed for ${payload.item}`);
    },
});

const emailConfirmer = neuron('email-confirmer', {}).dendrite({
    collateral: emailSent,
    response: payload => {
        console.log(`    ✅ Email sent: ${payload.type}`);
    },
});

const auditConfirmer = neuron('audit-confirmer', {}).dendrite({
    collateral: auditLogged,
    response: payload => {
        console.log(`    ✅ Audit logged: ${payload.action}`);
    },
});

// Create CNS instance
const cns = new CNS([
    orderProcessor,
    inventoryService,
    emailService,
    auditService,
    inventoryConfirmer,
    emailConfirmer,
    auditConfirmer,
]);

// Demo: Process an order
console.log(
    '🎬 Example 1: Fan-out pattern - single order splits into multiple parallel tasks\n'
);

await new Promise<void>(resolve => {
    let signalCount = 0;

    cns.stimulate(
        orderPlaced.createSignal({
            orderId: 'ORD-001',
            items: ['Widget-A', 'Widget-B', 'Widget-C'],
        }),
        {
            onResponse: response => {
                signalCount++;
                if (response.queueLength === 0) {
                    console.log(
                        `\n✨ Completed! Processed ${signalCount} signals\n`
                    );
                    resolve();
                }
            },
        }
    );
});

// Example 2: Stimulate with multiple initial signals
console.log('🎬 Example 2: Start stimulation with multiple orders at once\n');

await new Promise<void>(resolve => {
    let signalCount = 0;

    cns.stimulate(
        [
            orderPlaced.createSignal({
                orderId: 'ORD-002',
                items: ['Product-X'],
            }),
            orderPlaced.createSignal({
                orderId: 'ORD-003',
                items: ['Product-Y', 'Product-Z'],
            }),
        ],
        {
            onResponse: response => {
                signalCount++;
                if (response.queueLength === 0) {
                    console.log(
                        `\n✨ Completed! Processed ${signalCount} signals from 2 parallel orders\n`
                    );
                    resolve();
                }
            },
        }
    );
});

// Example 3: Conditional array returns
const validationInput = collateral<{ data: any; shouldValidate: boolean }>(
    'validation-input'
);
const validationSuccess = collateral<{ data: any }>('validation-success');
const validationError = collateral<{ error: string }>('validation-error');
const validationAudit = collateral<{ validated: boolean }>('validation-audit');

const validator = neuron('validator', {
    validationSuccess,
    validationError,
    validationAudit,
}).dendrite({
    collateral: validationInput,
    response: (payload, axon) => {
        const signals = [];

        if (payload.shouldValidate) {
            console.log(`  ✅ Validation passed`);
            signals.push(
                axon.validationSuccess.createSignal({ data: payload.data })
            );
        } else {
            console.log(`  ❌ Validation failed`);
            signals.push(
                axon.validationError.createSignal({ error: 'Invalid data' })
            );
        }

        // Always audit
        signals.push(
            axon.validationAudit.createSignal({
                validated: payload.shouldValidate,
            })
        );

        return signals;
    },
});

const successHandler = neuron('success-handler', {}).dendrite({
    collateral: validationSuccess,
    response: () => {
        console.log(`    ✨ Success handler executed`);
    },
});

const errorHandler = neuron('error-handler', {}).dendrite({
    collateral: validationError,
    response: payload => {
        console.log(`    ⚠️ Error handler executed: ${payload.error}`);
    },
});

const auditHandler = neuron('audit-handler', {}).dendrite({
    collateral: validationAudit,
    response: payload => {
        console.log(`    📋 Audit: validation=${payload.validated}`);
    },
});

const cns2 = new CNS([validator, successHandler, errorHandler, auditHandler]);

console.log(
    '🎬 Example 3: Conditional array returns - different paths based on validation\n'
);

console.log('Test 1: Valid data');
await new Promise<void>(resolve => {
    cns2.stimulate(
        validationInput.createSignal({
            data: { name: 'Test' },
            shouldValidate: true,
        }),
        {
            onResponse: r => {
                if (r.queueLength === 0) {
                    console.log('');
                    resolve();
                }
            },
        }
    );
});

console.log('Test 2: Invalid data');
await new Promise<void>(resolve => {
    cns2.stimulate(
        validationInput.createSignal({ data: null, shouldValidate: false }),
        {
            onResponse: r => {
                if (r.queueLength === 0) {
                    console.log('');
                    resolve();
                }
            },
        }
    );
});

console.log('✅ Array Signals Demo completed!\n');
console.log('📚 Key takeaways:');
console.log('   - Neurons can return arrays of signals for fan-out patterns');
console.log('   - Stimulate can accept arrays of initial signals');
console.log('   - Conditional logic can determine which signals to emit');
console.log(
    '   - Each signal in the array triggers its own subscribers independently'
);
console.log('');
