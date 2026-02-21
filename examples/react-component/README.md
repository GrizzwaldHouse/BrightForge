# React Component Example

**Difficulty:** Intermediate
**Time:** 10 minutes
**Features:** Coding Agent, Multi-File Editing, TypeScript

---

## Overview

Create a reusable React button component with TypeScript, demonstrating BrightForge's ability to handle multi-file projects and modern JavaScript frameworks.

**What you'll learn:**
- Generating React components
- TypeScript integration
- Multi-file editing
- Import dependency tracking
- Component props and hooks

---

## Prerequisites

- Node.js 18+
- BrightForge installed
- Basic React and TypeScript knowledge

---

## Instructions

### Step 1: Initialize Project

```bash
cd examples/react-component

# Create package.json
npm init -y

# Install React and TypeScript dependencies
npm install react react-dom typescript @types/react @types/react-dom
```

### Step 2: Generate Component

```bash
node ../../bin/brightforge.js "create a reusable Button component in TypeScript with variants (primary, secondary, danger) and onClick handler" --project .
```

### Step 3: Review the Plan

BrightForge will generate:
- `Button.tsx` - Component implementation
- `Button.types.ts` - TypeScript interfaces
- `index.ts` - Barrel export

### Step 4: Approve and Apply

Type `y` when prompted.

### Step 5: Verify Output

Check generated files:

```bash
ls -la
cat Button.tsx
cat Button.types.ts
```

---

## Expected Output

### Button.types.ts

```typescript
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}
```

### Button.tsx

```typescript
import React from 'react';
import { ButtonProps } from './Button.types';

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  onClick,
  disabled = false,
  children,
  className = ''
}) => {
  const variantStyles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white'
  };

  const baseStyles = 'px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

export default Button;
```

### index.ts

```typescript
export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button.types';
```

---

## Usage Example

Create a test file:

```bash
node ../../bin/brightforge.js "create App.tsx that demonstrates all Button variants with onClick handlers" --project .
```

**Generated App.tsx:**

```typescript
import React from 'react';
import { Button } from './index';

const App: React.FC = () => {
  const handleClick = (variant: string) => {
    console.log(`${variant} button clicked!`);
  };

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '10px' }}>
      <Button variant="primary" onClick={() => handleClick('Primary')}>
        Primary Button
      </Button>

      <Button variant="secondary" onClick={() => handleClick('Secondary')}>
        Secondary Button
      </Button>

      <Button variant="danger" onClick={() => handleClick('Danger')}>
        Danger Button
      </Button>

      <Button variant="primary" disabled>
        Disabled Button
      </Button>
    </div>
  );
};

export default App;
```

---

## Variations

Try these advanced prompts:

```bash
# Add loading state
node ../../bin/brightforge.js "add a loading prop to Button that shows a spinner and disables the button" --project .

# Add size variants
node ../../bin/brightforge.js "add size prop with small, medium, large variants" --project .

# Add icon support
node ../../bin/brightforge.js "add optional leftIcon and rightIcon props that accept React elements" --project .

# Generate tests
node ../../bin/brightforge.js "create Button.test.tsx with React Testing Library tests for all variants" --project .

# Add Storybook stories
node ../../bin/brightforge.js "create Button.stories.tsx with Storybook stories showcasing all props" --project .
```

---

## Troubleshooting

### TypeScript Errors

If BrightForge generates JavaScript instead of TypeScript:

```bash
# Be more explicit in your prompt
node ../../bin/brightforge.js "create a TypeScript React component named Button with .tsx extension and proper TypeScript types" --project .
```

### Missing Dependencies

If imports fail:

```bash
npm install react react-dom typescript @types/react @types/react-dom
```

### Incorrect Styling

If Tailwind classes are used but not configured:

```bash
# Option 1: Install Tailwind
npm install tailwindcss
npx tailwindcss init

# Option 2: Request inline styles
node ../../bin/brightforge.js "convert Button component to use inline styles instead of Tailwind" --project .
```

---

## Next Steps

1. Try the [Full-Stack App](../full-stack-app/) example (advanced)
2. Explore React hooks integration
3. Add form validation logic

---

## License

MIT License - see [LICENSE](../../LICENSE) for details.
