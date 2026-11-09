-- 0033: count large bags only (checked suitcases, about 24" and up). Small / medium bags and cabin bags
-- ride in the space left or on laps, and customers tended to count cabin bags too.
-- Each vehicle keeps one number in the settings screen: "takes N large bags" (stored as
-- luggage_units = 2N, max_bags = N, so vehicle_fits() keeps working unchanged).
update vehicles set
  max_bags = least(luggage_units / 2, max_bags),
  luggage_units = 2 * least(luggage_units / 2, max_bags);

-- small bags given before this change no longer count
update shuttle_trips set small_bags = 0 where small_bags <> 0 and status::text not in ('done', 'cancelled');
