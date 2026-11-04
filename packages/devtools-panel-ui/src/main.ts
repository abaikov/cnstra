import { CNSDevToolsPageConfig } from './transport/CNSDevToolsPageConfig';
import { createCNSDemoTransport } from './transport/demoTransport';
import { mountCNSDevToolsPanelFromPageConfig } from './mountCNSDevToolsPanelFromPageConfig';

const root = document.getElementById('root');
if (root) mountCNSDevToolsPanelFromPageConfig(root, CNSDevToolsPageConfig.read(), createCNSDemoTransport);
