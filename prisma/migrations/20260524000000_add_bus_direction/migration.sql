-- Vialink — Agrega dirección de marcha al bus.
--
-- direction = 1  → avanzando (fraction sube de 0 a 1)
-- direction = -1 → devolviéndose (fraction baja de 1 a 0)
--
-- El BusEngine usa esto para "bounce" en los extremos del corridor:
-- al llegar a fraction=1 hace direction=-1 y empieza a regresar por la
-- misma ruta, en vez de teleport al inicio (bug previo).

ALTER TABLE buses
  ADD COLUMN IF NOT EXISTS direction smallint NOT NULL DEFAULT 1;

-- Garantía: solo 1 o -1
ALTER TABLE buses
  DROP CONSTRAINT IF EXISTS buses_direction_check;
ALTER TABLE buses
  ADD CONSTRAINT buses_direction_check CHECK (direction IN (1, -1));
