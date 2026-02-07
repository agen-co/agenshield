import { Search } from 'lucide-react';
import { CircularLoader } from '../../../elements/loaders/CircularLoader';
import { Root, IconWrapper, Input } from './SearchInput.styles';
import type { SearchInputProps } from './SearchInput.types';

export function SearchInput({ value, onChange, placeholder = 'Search...', loading = false }: SearchInputProps) {
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
      {loading && (
        <CircularLoader size={16} sx={{ mr: 1.5, flexShrink: 0 }} />
      )}
    </Root>
  );
}
