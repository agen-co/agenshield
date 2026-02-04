import { styled } from '@mui/material/styles';

export const ChartWrapper = styled('div', {
  name: 'TrafficChart',
  slot: 'ChartWrapper',
})({
  width: '100%',
  height: 300,
  minWidth: 0,
  minHeight: 200,
});

export const TimeRangeGroup = styled('div', {
  name: 'TrafficChart',
  slot: 'TimeRange',
})(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.5),
}));
