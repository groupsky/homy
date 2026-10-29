# Air-conditioning

## Parts
* touch screen room thermostat BAC-1000 4pipe [manual](BAC-1000Modbus%20protocol.pdf) [aliexpress](https://s.click.aliexpress.com/e/_APYXl8)
* touch screen room thermostat BAC-002 4pipe [aliexpress](https://s.click.aliexpress.com/e/_AOsUP8)
* touch screen room thermostat BAC-002 2pipe [aliexpress](https://s.click.aliexpress.com/e/_ABSdv8)

## Fan-coil convectors
* 4 connected fan coils, all SILP Klimafan IO 030 (built-in type). [maker page](https://silpbg.com/klimafan/)
* Connection: PPR pipe, flexible hose, brass fittings. Coil connection 1/2". The label reads "IO 030 KFT, 1/2\"".
* They get borehole water directly, for cooling in summer only. They are not fed by the heat pump. A manual valve on each unit limits its flow.
* Maker data (table "Series KFT", column 030). Only the cooling row applies here; the heating rows are maker data only.

  | Mode | Water flow | Output | Pressure drop |
  |---|---|---|---|
  | Cooling 7/12 °C | 255 L/h | 1.49 kW | 9.5 kPa |
  | Heating 70/60 °C | 315 L/h | 3.68 kW | 10 kPa |
  | Heating, 50 °C in | 255 L/h | 2.04 kW | 5.8 kPa |

* The four BAC-002 thermostats on the `monitoring` bus (0x41–0x44) are probably their controls. Not confirmed.
