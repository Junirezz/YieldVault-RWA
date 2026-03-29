import React from "react";
import { Button, Input, Card, Table, Thead, Tbody, Tr, Th, Td } from "../components/ui";

const UIPreview: React.FC = () => {
  return (
    <div className="ui-preview-page">
      <h1 className="text-gradient" style={{ marginBottom: "40px" }}>UI Component Kit</h1>

      <section style={{ marginBottom: "60px" }}>
        <h2>Buttons</h2>
        <Card noHover header={<h3>Variants</h3>}>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="primary">Primary Button</Button>
            <Button variant="secondary">Secondary Button</Button>
            <Button variant="outline">Outline Button</Button>
            <Button variant="danger">Danger Button</Button>
          </div>
        </Card>

        <Card noHover header={<h3>Sizes</h3>} style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
        </Card>

        <Card noHover header={<h3>States</h3>} style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
            <Button isLoading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button leftIcon={<span>←</span>}>Icon Left</Button>
            <Button rightIcon={<span>→</span>}>Icon Right</Button>
          </div>
        </Card>
      </section>

      <section style={{ marginBottom: "60px" }}>
        <h2>Inputs</h2>
        <Card noHover>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <Input label="Default Input" placeholder="Type something..." />
            <Input label="With Helper Text" helperText="This is a useful tip" placeholder="Focus me" />
            <Input label="Error State" error="This field is required" defaultValue="Invalid value" />
            <Input label="Disabled Input" disabled placeholder="Can't type here" />
            <Input label="With Icon" leftIcon={<span>🔍</span>} placeholder="Search..." />
            <Input label="Password" type="password" placeholder="••••••••" />
          </div>
        </Card>
      </section>

      <section style={{ marginBottom: "60px" }}>
        <h2>Cards</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <Card header={<h3>Standard Card</h3>} footer={<p>Card Footer</p>}>
            <p>This is a standard card with a header and footer. It has a hover effect by default.</p>
          </Card>
          <Card noHover header={<h3>Static Card</h3>}>
            <p>This card has <code>noHover</code> prop set, so it won't lift on hover.</p>
          </Card>
        </div>
      </section>

      <section style={{ marginBottom: "60px" }}>
        <h2>Tables</h2>
        <Card noPadding noHover>
          <Table>
            <Thead>
              <Tr>
                <Th>Asset</Th>
                <Th>Balance</Th>
                <Th>Yield (APY)</Th>
                <Th align="right">Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              <Tr>
                <Td>USDC</Td>
                <Td>5,000.00</Td>
                <Td>8.45%</Td>
                <Td align="right"><span className="tag cyan">Active</span></Td>
              </Tr>
              <Tr>
                <Td>yvUSDC</Td>
                <Td>4,612.45</Td>
                <Td>--</Td>
                <Td align="right"><span className="tag cyan">Staked</span></Td>
              </Tr>
              <Tr>
                <Td>XLM</Td>
                <Td>120.00</Td>
                <Td>0.00%</Td>
                <Td align="right"><span style={{ opacity: 0.5 }}>Idle</span></Td>
              </Tr>
            </Tbody>
          </Table>
        </Card>
      </section>
    </div>
  );
};

export default UIPreview;
