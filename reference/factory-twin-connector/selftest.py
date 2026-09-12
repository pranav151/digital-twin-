"""
Runs the simulator connector for a few seconds through the real twin_state
engine and prints station snapshots — proves the connector/schema/state-engine
wiring actually works end to end before you touch a UI or a real endpoint.
"""
import asyncio
from twin_state import DigitalTwinState
from connectors.simulator_connector import SimulatorConnector
from schema import TwinEvent


async def main():
    queue: "asyncio.Queue[TwinEvent]" = asyncio.Queue()
    twin = DigitalTwinState()

    printed = []
    async def log_broadcast(payload):
        printed.append(payload)

    twin.add_broadcaster(log_broadcast)

    connector = SimulatorConnector(queue, plant_id="PLANT_01", line_id="LINE_01",
                                    params_path="config/station_params.json",
                                    tick_seconds=0.02, sim_dt_s=2.0)  # fast wall-clock, 2 sim-seconds/tick

    consumer_task = asyncio.create_task(twin.consume(queue))
    connector_task = asyncio.create_task(connector.run())

    await asyncio.sleep(8)  # ~400 ticks -> ~800 simulated seconds, enough for every station to complete cycles
    connector.stop()
    await asyncio.sleep(0.5)
    consumer_task.cancel()
    connector_task.cancel()

    print(f"\nTotal events broadcast: {len(printed)}")
    print("\nFinal station snapshots:")
    for sid, snap in sorted(twin.stations.items()):
        print(f"  {sid}: state={snap.state.value:9s} parts={snap.parts_count:3d} "
              f"buffer={snap.buffer_level} source={snap.source.value}")

    print(f"\nBottleneck detected: {twin.bottleneck()}")

    states_seen = {p["state"] for p in printed}
    print(f"\nDistinct machine states observed during run: {sorted(states_seen)}")


if __name__ == "__main__":
    asyncio.run(main())
