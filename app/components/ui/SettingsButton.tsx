import { memo } from 'react';
import { IconButton } from '~/components/ui/IconButton';

interface HelpButtonProps {
  onClick: () => void;
}

export const HelpButton = memo(({ onClick }: HelpButtonProps) => {
  return (
    <IconButton
      onClick={onClick}
      icon="i-ph:question"
      size="xl"
      title="Help & Documentation"
      data-testid="help-button"
      className="text-[#666] hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive/10 transition-colors"
    />
  );
});
