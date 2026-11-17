-- Member tier thresholds follow the marketing content: Silver 5,000 / Gold 10,000
update member_tiers set min_spend = 5000  where code = 'silver';
update member_tiers set min_spend = 10000 where code = 'gold';
