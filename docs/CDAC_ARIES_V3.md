# C-DAC ARIES v3.0 RISC-V Development Board

> **Date Added to Logicraft Studios Simulator:** 11-09-2026  
> **Target Architecture:** RISC-V 32-bit (RV32IM)  
> **System-on-Chip (SoC):** C-DAC THEJAS32 / VEGA ET1031 @ 100 MHz  
> **Arduino FQBN:** `vega:riscv:aries_v3`  

For the complete technical manual, pinouts, and hardware datasheets, see:
- [ARIES v3.0 Board Documentation](file:///k:/velxio-master/docs/boards/aries-v3.md)
- [Component Datasheet](file:///k:/velxio-master/frontend/src/components/component-docs/boards/aries-v3.md)

---

## Highlights

* **SoC:** C-DAC THEJAS32 (VEGA ET1031 RISC-V core @ 100 MHz)
* **Memory:** 256 KB internal SRAM, 2 MB external SPI flash
* **Digital I/O:** 32 GPIO pins (0–31), 8 PWM pins, 4 ADC channels
* **Onboard LEDs:** 
  - **LD4:** Processor Heartbeat LED (Orange, automatic 1 Hz pulse during simulation)
  - **LD1:** Multi-channel RGB LED (Pins 22=Green, 23=Blue, 24=Red, Active-Low)
* **I²C Support:** 2 independent hardware controllers (`Wire(1)` on Header J1 SDA1/SCL1, `Wire(0)` on Header J10). Seamlessly auto-configured for Arduino I2C libraries.
* **Added Date:** 11-09-2026

