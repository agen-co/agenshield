import { Search } from 'lucide-react';
import { Root, IconWrapper, Input } from './SearchInput.styles';
import type { SearchInputProps } from './SearchInput.types';

export function SearchInput({ value, onChange, placeholder = 'Search...' }: SearchInputProps) {
  return (
    <Root>
      <IconWrapper>
        <Search size={16} />
      </IconWrapper>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Root>
  );
}
